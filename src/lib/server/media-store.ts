/**
 * Media registry on disk: storage/media/<id>/{meta.json, source.*, thumb.jpg,
 * proxy.mp4, envelope.bin, transcript.json}. Files of the resources folder
 * are registered without copying (external = true).
 */
import path from 'node:path';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { nanoid } from 'nanoid';
import type { MediaInfo, MediaKind, MediaRole, Transcript } from '../shared/types';
import { config } from './config';
import { probe } from './ffmpeg';

export interface MediaRecord extends MediaInfo {
  sourcePath: string;
  mtimeMs: number;
}

export const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp'];
export const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'];
export const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus'];

export const extOf = (name: string) => path.extname(name).slice(1).toLowerCase();

export const isValidId = (id: string) => /^[A-Za-z0-9_-]{6,40}$/.test(id);

export function mediaPaths(id: string) {
  const dir = path.join(config.storageDir, 'media', id);
  return {
    dir,
    meta: path.join(dir, 'meta.json'),
    thumb: path.join(dir, 'thumb.jpg'),
    proxy: path.join(dir, 'proxy.mp4'),
    envelope: path.join(dir, 'envelope.bin'),
    transcript: path.join(dir, 'transcript.json'),
  };
}

export const newMediaId = () => nanoid(12);

const g = globalThis as unknown as { __verticutMedia?: Map<string, MediaRecord>; __verticutMediaLocks?: Map<string, Promise<unknown>> };
const cache = (g.__verticutMedia ??= new Map());
const locks = (g.__verticutMediaLocks ??= new Map());

async function writeJsonAtomic(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, file);
}

export async function getMedia(id: string): Promise<MediaRecord | null> {
  if (!isValidId(id)) return null;
  const hit = cache.get(id);
  if (hit) return hit;
  try {
    const rec = JSON.parse(await readFile(/*turbopackIgnore: true*/ mediaPaths(id).meta, 'utf8')) as MediaRecord;
    cache.set(id, rec);
    return rec;
  } catch {
    return null;
  }
}

/** Serialised read-modify-write of a media record. */
export function updateMedia(id: string, patch: Partial<MediaRecord> | ((rec: MediaRecord) => Partial<MediaRecord>)): Promise<MediaRecord> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      const rec = await getMedia(id);
      if (!rec) throw new Error(`Medio ${id} no encontrado`);
      const changes = typeof patch === 'function' ? patch(rec) : patch;
      const updated: MediaRecord = { ...rec, ...changes, transcript: { ...rec.transcript, ...(changes.transcript ?? {}) } };
      cache.set(id, updated);
      await writeJsonAtomic(mediaPaths(id).meta, updated);
      return updated;
    });
  locks.set(id, next);
  return next;
}

export async function saveNewMedia(rec: MediaRecord) {
  cache.set(rec.id, rec);
  await writeJsonAtomic(mediaPaths(rec.id).meta, rec);
}

export function toPublic(rec: MediaRecord): MediaInfo {
  const { sourcePath: _s, mtimeMs: _m, ...pub } = rec;
  return pub;
}

function kindFor(ext: string, hasVideo: boolean): MediaKind {
  if (IMAGE_EXT.includes(ext)) return 'image';
  return hasVideo ? 'video' : 'audio';
}

/** Probes a file and creates its media record. Throws if FFmpeg cannot read it. */
export async function registerFile(opts: { id?: string; filePath: string; name: string; role: MediaRole; external: boolean }): Promise<MediaRecord> {
  const info = await probe(opts.filePath);
  const st = await stat(opts.filePath);
  const ext = extOf(opts.name);
  const kind = kindFor(ext, info.hasVideo);
  if (kind === 'audio' && !info.hasAudio) throw new Error('El archivo no contiene audio ni vídeo');
  if (opts.role === 'clip' && kind !== 'video') throw new Error('Los clips principales deben ser vídeos (mp4, mov…)');
  const rec: MediaRecord = {
    id: opts.id ?? newMediaId(),
    name: opts.name,
    role: opts.role,
    kind,
    external: opts.external,
    size: st.size,
    createdAt: new Date().toISOString(),
    duration: kind === 'image' ? 0 : info.duration,
    width: info.width,
    height: info.height,
    fps: info.fps,
    hasAudio: kind !== 'image' && info.hasAudio,
    videoCodec: info.videoCodec,
    audioCodec: info.audioCodec,
    hasProxy: false,
    hasThumb: false,
    hasEnvelope: false,
    status: 'processing',
    stage: 'En cola',
    progress: 0,
    error: null,
    transcript: { status: 'none', progress: 0, error: null, provider: null, language: null },
    sourcePath: opts.filePath,
    mtimeMs: st.mtimeMs,
  };
  await saveNewMedia(rec);
  return rec;
}

export async function readTranscript(id: string): Promise<Transcript | null> {
  try {
    return JSON.parse(await readFile(/*turbopackIgnore: true*/ mediaPaths(id).transcript, 'utf8')) as Transcript;
  } catch {
    return null;
  }
}

export async function writeTranscript(t: Transcript) {
  await writeJsonAtomic(mediaPaths(t.mediaId).transcript, t);
}

export { writeJsonAtomic };
