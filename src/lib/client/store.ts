'use client';
/**
 * Editor state. `doc` is the saved project; every change to it goes through
 * `commit` so it can be undone. Everything else (media info, transcripts,
 * selection, UI) is session state outside the undo history.
 */
import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import type { Envelope, MediaInfo, ProjectDoc, ServerStatus, Word } from '@/lib/shared/types';

export type Selection =
  | { kind: 'words'; anchor: number; focus: number }
  | { kind: 'segment'; clipId: string; rangeIndex: number }
  | { kind: 'broll'; id: string }
  | { kind: 'audio'; id: string }
  | { kind: 'text'; id: string }
  | { kind: 'subtitle'; page: number }
  | null;

export interface Upload {
  id: string;
  name: string;
  progress: number;
  error: string | null;
}

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
}

const HISTORY_LIMIT = 200;
const COALESCE_MS = 1200;

interface EditorState {
  doc: ProjectDoc | null;
  past: ProjectDoc[];
  future: ProjectDoc[];
  lastCommit: { key: string; at: number } | null;
  saveState: 'idle' | 'pending' | 'saving' | 'saved' | 'error';
  media: Record<string, MediaInfo>;
  transcripts: Record<string, Word[]>;
  envelopes: Record<string, Envelope>;
  resourcesDir: string;
  resourceIds: string[];
  selection: Selection;
  uploads: Upload[];
  toasts: Toast[];
  status: ServerStatus | null;
  /** Local transcription installer dialog. */
  setupOpen: boolean;
  /** Preview videos with the chosen voice/music mix, per media id. */
  mixUrls: Record<string, string>;

  load(doc: ProjectDoc): void;
  /** Applies a pure update to the document as one undo step. */
  commitDoc(update: (doc: ProjectDoc) => ProjectDoc, coalesceKey?: string): void;
  /** Immer recipe variant of commitDoc. */
  commit(recipe: (d: Draft<ProjectDoc>) => void, coalesceKey?: string): void;
  undo(): void;
  redo(): void;
  setSelection(sel: Selection): void;
  upsertMedia(list: MediaInfo[]): void;
  setTranscript(id: string, words: Word[] | null): void;
  setEnvelope(id: string, env: Envelope): void;
  setResources(dir: string, list: MediaInfo[]): void;
  setUpload(u: Upload | { id: string; remove: true }): void;
  toast(message: string, kind?: Toast['kind']): void;
  dismissToast(id: number): void;
  set(partial: Partial<EditorState>): void;
}

let toastSeq = 0;

export const useEditor = create<EditorState>((set, get) => ({
  doc: null,
  past: [],
  future: [],
  lastCommit: null,
  saveState: 'idle',
  media: {},
  transcripts: {},
  envelopes: {},
  resourcesDir: '',
  resourceIds: [],
  selection: null,
  uploads: [],
  toasts: [],
  status: null,
  setupOpen: false,
  mixUrls: {},

  load: (doc) => set({ doc, past: [], future: [], lastCommit: null, selection: null, saveState: 'saved' }),

  commitDoc: (update, coalesceKey) => {
    const { doc, past, lastCommit } = get();
    if (!doc) return;
    const next = update(doc);
    if (next === doc) return;
    const now = Date.now();
    const coalesce = !!coalesceKey && lastCommit?.key === coalesceKey && now - lastCommit.at < COALESCE_MS && past.length > 0;
    set({
      doc: next,
      past: coalesce ? past : [...past.slice(-HISTORY_LIMIT + 1), doc],
      future: [],
      lastCommit: coalesceKey ? { key: coalesceKey, at: now } : null,
      saveState: 'pending',
    });
  },

  commit: (recipe, coalesceKey) => get().commitDoc((doc) => produce(doc, recipe), coalesceKey),

  undo: () => {
    const { doc, past, future } = get();
    if (!doc || !past.length) return;
    set({ doc: past[past.length - 1], past: past.slice(0, -1), future: [doc, ...future], lastCommit: null, selection: null, saveState: 'pending' });
  },

  redo: () => {
    const { doc, past, future } = get();
    if (!doc || !future.length) return;
    set({ doc: future[0], past: [...past, doc], future: future.slice(1), lastCommit: null, selection: null, saveState: 'pending' });
  },

  setSelection: (selection) => set({ selection }),

  upsertMedia: (list) => {
    if (!list.length) return;
    const media = { ...get().media };
    for (const m of list) media[m.id] = m;
    set({ media });
  },

  setTranscript: (id, words) => {
    const transcripts = { ...get().transcripts };
    if (words) transcripts[id] = words;
    else delete transcripts[id];
    set({ transcripts });
  },

  setEnvelope: (id, env) => set({ envelopes: { ...get().envelopes, [id]: env } }),

  setResources: (dir, list) => {
    get().upsertMedia(list);
    set({ resourcesDir: dir, resourceIds: list.map((m) => m.id) });
  },

  setUpload: (u) => {
    const uploads = get().uploads.filter((x) => x.id !== u.id);
    set({ uploads: 'remove' in u ? uploads : [...uploads, u].sort((a, b) => a.id.localeCompare(b.id)) });
  },

  toast: (message, kind = 'info') => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts.slice(-3), { id, message, kind }] });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 4000);
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  set: (partial) => set(partial),
}));
