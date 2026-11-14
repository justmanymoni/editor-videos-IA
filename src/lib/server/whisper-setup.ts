/**
 * One-click installation of offline transcription: downloads the official
 * whisper.cpp build for this system (Windows or Linux) and a ggml model into
 * storage/whisper. After that, transcription works without internet or API keys.
 */
import path from 'node:path';
import os from 'node:os';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, open, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { WHISPER_MODELS } from '../shared/whisper-models';
import { config, whisperCppBinary } from './config';
import { run, runChecked } from './ffmpeg';
import { jobs, type JobContext } from './jobs';
import { enqueueTranscribe } from './ingest';
import { getMedia } from './media-store';
import { extractZip } from './unzip';
import { engineFailureMessage } from './transcribe/whispercpp';

/** Releases known to publish prebuilt binaries (newest first). */
const RELEASES = ['v1.9.2', 'v1.9.1', 'v1.8.7'];
const GGML_MAGIC = 0x67676d6c;

const releaseBase = () => (process.env.WHISPER_CPP_RELEASE_BASE || 'https://github.com/ggml-org/whisper.cpp/releases/download').replace(/\/$/, '');
const modelBase = () => (process.env.WHISPER_MODEL_BASE || 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main').replace(/\/$/, '');

/** Prebuilt archive for this system, or null (macOS: install with Homebrew). */
export function releaseAsset(): string | null {
  if (process.platform === 'win32') return 'whisper-bin-x64.zip';
  if (process.platform === 'linux' && os.arch() === 'x64') return 'whisper-bin-ubuntu-x64.tar.gz';
  if (process.platform === 'linux' && os.arch() === 'arm64') return 'whisper-bin-ubuntu-arm64.tar.gz';
  return null;
}

class HttpError extends Error {
  constructor(
    public status: number,
    url: string,
  ) {
    super(`La descarga falló (HTTP ${status}): ${url}`);
  }
}

/** Streams a URL to disk, reporting bytes received. Writes to .part and renames at the end. */
export async function download(url: string, dest: string, onProgress: (received: number, total: number) => void, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(url, { redirect: 'follow', signal });
  } catch (err) {
    if (signal?.aborted) throw new Error('Cancelado');
    throw new Error(`No se pudo conectar para descargar ${url}. ¿Hay conexión a internet? (${err instanceof Error ? err.message : err})`);
  }
  if (!res.ok || !res.body) throw new HttpError(res.status, url);
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      onProgress(received, total);
      cb(null, chunk);
    },
  });
  await mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body as NodeReadableStream), counter, createWriteStream(part), { signal });
  } catch (err) {
    await rm(part, { force: true });
    throw signal?.aborted ? new Error('Cancelado') : err;
  }
  if (total && received !== total) {
    await rm(part, { force: true });
    throw new Error('La descarga se cortó antes de terminar. Vuelve a intentarlo.');
  }
  await rename(part, dest);
}

/** Downloads and unpacks whisper.cpp unless an engine is already available. */
export async function installEngine(onProgress: (p: number) => void, signal?: AbortSignal): Promise<string> {
  const existing = whisperCppBinary();
  if (existing) return existing;
  const asset = releaseAsset();
  if (!asset) {
    throw new Error(
      process.platform === 'darwin'
        ? 'En Mac instala el motor con «brew install whisper-cpp» y vuelve a pulsar Instalar: el modelo se descarga desde aquí.'
        : `No hay una versión precompilada de whisper.cpp para ${process.platform}/${os.arch()}. Compílalo (ver README) e indica WHISPER_CPP_BIN.`,
    );
  }
  const binDir = path.join(config.whisperDir, 'bin');
  const archive = path.join(config.whisperDir, asset);
  const versions = [process.env.WHISPER_CPP_VERSION, ...RELEASES].filter((v): v is string => !!v);
  let downloaded = false;
  for (const version of versions) {
    try {
      await download(`${releaseBase()}/${version}/${asset}`, archive, (r, t) => onProgress(t ? r / t : 0), signal);
      downloaded = true;
      break;
    } catch (err) {
      if (!(err instanceof HttpError && err.status === 404)) throw err;
    }
  }
  if (!downloaded) throw new Error('No se encontró el motor whisper.cpp para descargar. Instálalo a mano (ver README).');

  await rm(binDir, { recursive: true, force: true });
  await mkdir(binDir, { recursive: true });
  if (asset.endsWith('.zip')) await extractZip(archive, binDir);
  else await runChecked('tar', ['-xzf', archive, '-C', binDir]);
  await rm(archive, { force: true });

  const bin = whisperCppBinary();
  if (!bin) throw new Error('El paquete descargado no contiene whisper-cli');
  if (process.platform !== 'win32') await chmod(bin, 0o755);
  const check = await run(bin, ['--help'], { signal });
  if (check.code !== 0) throw new Error(engineFailureMessage(check.code));
  return bin;
}

async function isGgml(file: string): Promise<boolean> {
  const fh = await open(file, 'r');
  try {
    const { buffer } = await fh.read(Buffer.alloc(4), 0, 4, 0);
    return buffer.readUInt32LE(0) === GGML_MAGIC;
  } finally {
    await fh.close();
  }
}

export const modelPath = (id: string) => path.join(config.whisperDir, 'models', `ggml-${id}.bin`);

/** Downloads a speech model (once) and makes it the active one. */
export async function installModel(id: string, onProgress: (received: number, total: number) => void, signal?: AbortSignal): Promise<string> {
  if (!WHISPER_MODELS.some((m) => m.id === id)) throw new Error(`Modelo desconocido: ${id}`);
  const file = modelPath(id);
  const present = await stat(file).catch(() => null);
  if (!present || !(await isGgml(file))) {
    await download(`${modelBase()}/ggml-${id}.bin`, file, onProgress, signal);
    if (!(await isGgml(file))) {
      await rm(file, { force: true });
      throw new Error('El archivo descargado no es un modelo de whisper válido. Vuelve a intentarlo.');
    }
  }
  await writeFile(path.join(config.whisperDir, 'config.json'), JSON.stringify({ model: id }, null, 2));
  return file;
}

/** Re-queues clips whose transcription failed because no engine was installed. */
async function transcribePending() {
  const dir = path.join(config.storageDir, 'media');
  const ids = await readdir(dir).catch(() => [] as string[]);
  for (const id of ids) {
    const rec = await getMedia(id);
    if (rec?.role === 'clip' && rec.hasAudio && (rec.transcript.status === 'error' || rec.transcript.status === 'none')) {
      await enqueueTranscribe(id, rec.transcript.language || config.defaultLanguage);
    }
  }
}

const mb = (bytes: number) => Math.round(bytes / 1e6);

export async function runWhisperSetup(modelId: string, ctx: JobContext) {
  ctx.progress(0, 'Descargando el motor de transcripción…');
  const bin = await installEngine((p) => ctx.progress(p * 0.06, 'Descargando el motor de transcripción…'), ctx.signal);
  const model = await installModel(
    modelId,
    (r, t) =>
      ctx.progress(0.06 + (t ? (r / t) * 0.94 : 0), t ? `Descargando el modelo… ${mb(r)} de ${mb(t)} MB` : `Descargando el modelo… ${mb(r)} MB`),
    ctx.signal,
  );
  await transcribePending();
  return { bin, model };
}

export function startWhisperSetup(modelId: string) {
  return jobs.active('setup', 'whisper') ?? jobs.enqueue('setup', 'whisper', (ctx) => runWhisperSetup(modelId, ctx));
}
