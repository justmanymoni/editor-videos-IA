/**
 * The resources folder (BROLL_DIR, default ./recursos) holds B-roll clips,
 * images and music. Files dropped there appear in the editor after a rescan;
 * uploads from the editor are saved into the same folder.
 */
import path from 'node:path';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { config } from './config';
import { ffmpeg } from './ffmpeg';
import { enqueueIngest } from './ingest';
import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT, extOf, getMedia, registerFile, writeJsonAtomic, type MediaRecord } from './media-store';

const ALLOWED = new Set([...VIDEO_EXT, ...IMAGE_EXT, ...AUDIO_EXT]);
type Index = Record<string, { id: string; mtimeMs: number; size: number }>;

const indexPath = () => path.join(config.storageDir, 'resources-index.json');

async function readIndex(): Promise<Index> {
  try {
    return JSON.parse(await readFile(indexPath(), 'utf8')) as Index;
  } catch {
    return {};
  }
}

async function walk(dir: string, depth = 0): Promise<string[]> {
  if (depth > 3) return [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full, depth + 1)));
    else if (e.isFile() && ALLOWED.has(extOf(e.name))) out.push(full);
  }
  return out;
}

const roleFor = (file: string) => (AUDIO_EXT.includes(extOf(file)) ? 'music' : 'broll');

let scanning: Promise<MediaRecord[]> | null = null;

/** Registers new files of the resources folder and lists every resource. */
export function scanResources(): Promise<MediaRecord[]> {
  scanning ??= doScan().finally(() => {
    scanning = null;
  });
  return scanning;
}

async function doScan(): Promise<MediaRecord[]> {
  const dir = config.resourcesDir;
  await mkdir(dir, { recursive: true });
  const index = await readIndex();
  const next: Index = {};
  const out: MediaRecord[] = [];
  for (const file of await walk(dir)) {
    const st = await stat(file);
    const known = index[file];
    let rec = known && known.mtimeMs === st.mtimeMs && known.size === st.size ? await getMedia(known.id) : null;
    if (!rec) {
      try {
        rec = await registerFile({ filePath: file, name: path.relative(dir, file).split(path.sep).join('/'), role: roleFor(file), external: true });
        enqueueIngest(rec.id);
      } catch (err) {
        console.warn(`[recursos] se ignora ${file}:`, err instanceof Error ? err.message : err);
        continue;
      }
    }
    next[file] = { id: rec.id, mtimeMs: st.mtimeMs, size: st.size };
    out.push(rec);
  }
  await writeJsonAtomic(indexPath(), next);
  return out.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

async function uniquePath(dir: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const base =
    path
      .basename(name, ext)
      .replace(/[^\p{L}\p{N} ._-]+/gu, '_')
      .slice(0, 80) || 'recurso';
  for (let i = 0; ; i++) {
    const candidate = path.join(dir, i ? `${base} (${i})${ext}` : `${base}${ext}`);
    try {
      await stat(candidate);
    } catch {
      return candidate;
    }
  }
}

/** Saves an uploaded file into the resources folder and registers it. */
export async function uploadResource(name: string, body: ReadableStream<Uint8Array>): Promise<MediaRecord> {
  if (!ALLOWED.has(extOf(name))) throw new Error(`Formato no admitido: .${extOf(name)}`);
  await mkdir(config.resourcesDir, { recursive: true });
  const file = await uniquePath(config.resourcesDir, path.basename(name));
  await pipeline(Readable.fromWeb(body as import('node:stream/web').ReadableStream), createWriteStream(file));
  await scanResources();
  const index = await readIndex();
  const entry = index[file];
  const rec = entry && (await getMedia(entry.id));
  if (!rec) throw new Error('No se pudo leer el archivo subido');
  return rec;
}

/** Saves a microphone recording (any browser format) as an .m4a in the resources folder. */
export async function saveRecording(body: ReadableStream<Uint8Array>): Promise<MediaRecord> {
  await mkdir(config.resourcesDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const raw = path.join(config.resourcesDir, `.grabacion-${stamp}.tmp`);
  const file = await uniquePath(config.resourcesDir, `voz-${stamp}.m4a`);
  try {
    await pipeline(Readable.fromWeb(body as import('node:stream/web').ReadableStream), createWriteStream(raw));
    await ffmpeg(['-y', '-loglevel', 'error', '-i', raw, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'aac', '-b:a', '128k', file]);
  } finally {
    await rm(raw, { force: true });
  }
  await scanResources();
  const entry = (await readIndex())[file];
  const rec = entry && (await getMedia(entry.id));
  if (!rec) throw new Error('No se pudo guardar la grabación');
  return rec;
}
