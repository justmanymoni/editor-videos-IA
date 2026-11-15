import { spawn } from 'node:child_process';
import { config } from './config';

export interface RunOptions {
  cwd?: string;
  signal?: AbortSignal;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  onStdoutData?: (chunk: Buffer) => void;
}

export interface RunResult {
  code: number;
  stderr: string;
}

const STDERR_TAIL = 16_000;

function lineSplitter(cb: (line: string) => void) {
  let buf = '';
  return (chunk: Buffer) => {
    buf += chunk.toString('utf8');
    const parts = buf.split(/\r?\n|\r/);
    buf = parts.pop() ?? '';
    for (const p of parts) cb(p);
  };
}

/** Spawns a process without a shell (arguments are never interpreted). */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new Error('Cancelado'));
    const child = spawn(cmd, args, { cwd: opts.cwd, windowsHide: true });
    let stderr = '';
    const onErr = opts.onStderrLine ? lineSplitter(opts.onStderrLine) : null;
    const onOut = opts.onStdoutLine ? lineSplitter(opts.onStdoutLine) : null;
    child.stdout.on('data', (chunk: Buffer) => {
      opts.onStdoutData?.(chunk);
      onOut?.(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_TAIL);
      onErr?.(chunk);
    });
    const abort = () => child.kill('SIGKILL');
    opts.signal?.addEventListener('abort', abort, { once: true });
    child.on('error', (err: NodeJS.ErrnoException) => {
      opts.signal?.removeEventListener('abort', abort);
      reject(err.code === 'ENOENT' ? new Error(`No se encuentra el ejecutable "${cmd}". ¿Está instalado y en el PATH?`) : err);
    });
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', abort);
      if (opts.signal?.aborted) reject(new Error('Cancelado'));
      else resolve({ code: code ?? -1, stderr });
    });
  });
}

const tail = (s: string, n = 6) => s.trim().split(/\r?\n/).slice(-n).join('\n');

export async function runChecked(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const res = await run(cmd, args, opts);
  if (res.code !== 0) throw new Error(`${cmd} terminó con código ${res.code}:\n${tail(res.stderr)}`);
  return res;
}

export const ffmpeg = (args: string[], opts?: RunOptions) => runChecked(config.ffmpeg, ['-hide_banner', '-nostdin', ...args], opts);

/** Runs FFmpeg reporting progress (0..1) from `-progress` output. */
export function ffmpegWithProgress(args: string[], totalSeconds: number, onProgress: (p: number) => void, opts: RunOptions = {}) {
  return runChecked(config.ffmpeg, ['-hide_banner', '-nostdin', '-progress', 'pipe:1', '-nostats', ...args], {
    ...opts,
    onStdoutLine: (line) => {
      const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
      if (m && totalSeconds > 0) onProgress(Math.min(1, Number(m[1]) / 1e6 / totalSeconds));
    },
  });
}

export interface ProbeResult {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  pixFmt: string | null;
  formatName: string;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  duration?: string;
  disposition?: { attached_pic?: number };
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
}

const parseRate = (r?: string) => {
  if (!r) return 0;
  const [n, d] = r.split('/').map(Number);
  return d ? n / d : n || 0;
};

export async function probe(file: string): Promise<ProbeResult> {
  let out = '';
  const res = await run(config.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], {
    onStdoutData: (c) => {
      out += c.toString('utf8');
    },
  });
  if (res.code !== 0) throw new Error(`No se pudo leer el archivo: ${tail(res.stderr, 2) || 'formato no reconocido'}`);
  const data = JSON.parse(out) as { streams?: FfprobeStream[]; format?: { duration?: string; format_name?: string } };
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audio = streams.find((s) => s.codec_type === 'audio');
  let width = video?.width ?? 0;
  let height = video?.height ?? 0;
  const rotation = Number(video?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? video?.tags?.rotate ?? 0);
  if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  const duration = Number(data.format?.duration ?? video?.duration ?? audio?.duration ?? 0) || 0;
  return {
    duration,
    width,
    height,
    fps: parseRate(video?.avg_frame_rate) || parseRate(video?.r_frame_rate),
    hasVideo: !!video,
    hasAudio: !!audio,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    pixFmt: video?.pix_fmt ?? null,
    formatName: data.format?.format_name ?? '',
  };
}

let versionCache: Promise<string | null> | null = null;

/** FFmpeg version string ("6.1.1-3ubuntu5", "7.1", "N-118000-g…"), or null if missing. */
export function ffmpegVersion(): Promise<string | null> {
  versionCache ??= (async () => {
    let out = '';
    try {
      await run(config.ffmpeg, ['-hide_banner', '-version'], { onStdoutData: (c) => (out += c.toString('utf8')) });
    } catch {
      versionCache = null;
      return null;
    }
    return /ffmpeg version (\S+)/.exec(out)?.[1] ?? null;
  })();
  return versionCache;
}

let filtersCache: Promise<Set<string>> | null = null;

/** Whether this FFmpeg build has a filter (some, like the two-pass stabiliser, are optional). */
export async function ffmpegHasFilter(name: string): Promise<boolean> {
  filtersCache ??= (async () => {
    let out = '';
    try {
      await run(config.ffmpeg, ['-hide_banner', '-filters'], { onStdoutData: (c) => (out += c.toString('utf8')) });
    } catch {
      filtersCache = null;
    }
    return new Set(out.split('\n').map((l) => l.trim().split(/\s+/)[1] ?? ''));
  })();
  return (await filtersCache).has(name);
}

/** True when ffprobe can be executed (not cached: it may be installed while the app runs). */
export async function ffprobeAvailable(): Promise<boolean> {
  try {
    return (await run(config.ffprobe, ['-version'], {})).code === 0;
  } catch {
    return false;
  }
}

/** Major version; git builds ("N-…") count as recent. */
export async function ffmpegMajor(): Promise<number> {
  const v = await ffmpegVersion();
  if (!v) return 0;
  const m = /^n?(\d+)\./.exec(v);
  return m ? Number(m[1]) : 99;
}
