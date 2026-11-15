/**
 * In-process job queue. Heavy work (FFmpeg, whisper.cpp) runs in child
 * processes, so the Node event loop and the UI stay responsive; the queue
 * limits how many run at once per type and exposes progress for polling.
 */
import { nanoid } from 'nanoid';
import type { JobInfo, JobType } from '../shared/types';

export interface JobContext {
  id: string;
  signal: AbortSignal;
  progress(value: number, message?: string): void;
}

type Runner = (ctx: JobContext) => Promise<Record<string, unknown> | void>;

interface Entry {
  info: JobInfo;
  run: Runner;
  controller: AbortController;
  finishedAt?: number;
}

const limits = (): Record<JobType, number> => ({
  ingest: 2,
  transcribe: Number(process.env.TRANSCRIBE_CONCURRENCY) || 1,
  export: 1,
  setup: 1,
  separate: 1,
  mix: 2,
  filmstrip: 1,
});

const KEEP_FINISHED_MS = 60 * 60 * 1000;

/**
 * The data of the queue lives apart from its code: after an update of the app
 * the dev server reloads this module, and the new code must keep serving the
 * jobs that the old code started. Only ever mutated in place.
 */
interface QueueState {
  entries: Map<string, Entry>;
  pending: Entry[];
  running: Partial<Record<JobType, number>>;
}

class JobQueue {
  constructor(private state: QueueState) {}

  private get entries() {
    return this.state.entries;
  }
  private get pending() {
    return this.state.pending;
  }
  private get running() {
    return this.state.running;
  }

  private unqueue(entry: Entry) {
    const i = this.pending.indexOf(entry);
    if (i >= 0) this.pending.splice(i, 1);
  }

  enqueue(type: JobType, refId: string, run: Runner): JobInfo {
    this.gc();
    const info: JobInfo = {
      id: nanoid(12),
      type,
      refId,
      status: 'queued',
      progress: 0,
      message: null,
      error: null,
      result: null,
      createdAt: new Date().toISOString(),
    };
    const entry: Entry = { info, run, controller: new AbortController() };
    this.entries.set(info.id, entry);
    this.pending.push(entry);
    queueMicrotask(() => this.pump());
    return { ...info };
  }

  get(id: string): JobInfo | null {
    const e = this.entries.get(id);
    return e ? { ...e.info } : null;
  }

  /** Queued or running job of a type for a resource, if any. */
  active(type: JobType, refId: string): JobInfo | null {
    for (const e of this.entries.values()) {
      if (e.info.type === type && e.info.refId === refId && (e.info.status === 'queued' || e.info.status === 'running')) return { ...e.info };
    }
    return null;
  }

  /** True while any job is queued or running (the launcher waits for this before updating the app). */
  busy(): boolean {
    for (const e of this.entries.values()) if (e.info.status === 'queued' || e.info.status === 'running') return true;
    return false;
  }

  cancel(id: string): boolean {
    const e = this.entries.get(id);
    if (!e || (e.info.status !== 'queued' && e.info.status !== 'running')) return false;
    e.controller.abort();
    if (e.info.status === 'queued') {
      this.unqueue(e);
      this.finish(e, 'cancelled', null);
    }
    return true;
  }

  private pump() {
    const lim = limits();
    for (const entry of [...this.pending]) {
      const type = entry.info.type;
      if ((this.running[type] ?? 0) >= lim[type]) continue;
      this.unqueue(entry);
      this.running[type] = (this.running[type] ?? 0) + 1;
      void this.execute(entry);
    }
  }

  private async execute(entry: Entry) {
    const { info, controller } = entry;
    info.status = 'running';
    const ctx: JobContext = {
      id: info.id,
      signal: controller.signal,
      progress: (value, message) => {
        info.progress = Math.max(0, Math.min(1, value));
        if (message !== undefined) info.message = message;
      },
    };
    try {
      const result = await entry.run(ctx);
      this.finish(entry, 'done', null, result ?? null);
    } catch (err) {
      const aborted = controller.signal.aborted;
      this.finish(entry, aborted ? 'cancelled' : 'error', aborted ? 'Cancelado' : errorMessage(err));
      if (!aborted) console.error(`[job ${info.type}:${info.refId}]`, err);
    } finally {
      this.running[info.type] = Math.max(0, (this.running[info.type] ?? 1) - 1);
      this.pump();
    }
  }

  private finish(entry: Entry, status: JobInfo['status'], error: string | null, result: Record<string, unknown> | null = null) {
    entry.info.status = status;
    entry.info.error = error;
    entry.info.result = result;
    if (status === 'done') entry.info.progress = 1;
    entry.finishedAt = Date.now();
  }

  private gc() {
    const now = Date.now();
    for (const [id, e] of this.entries) if (e.finishedAt && now - e.finishedAt > KEEP_FINISHED_MS) this.entries.delete(id);
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// The state survives Next.js dev hot reloads; the queue object is rebuilt with the current code.
const g = globalThis as unknown as { __verticutJobState?: QueueState; __verticutJobs?: { entries?: Map<string, Entry> } };
const state: QueueState = (g.__verticutJobState ??= {
  // Jobs listed by a queue created before the state was kept apart.
  entries: g.__verticutJobs?.entries instanceof Map ? g.__verticutJobs.entries : new Map<string, Entry>(),
  pending: [],
  running: {},
});
export const jobs = new JobQueue(state);
