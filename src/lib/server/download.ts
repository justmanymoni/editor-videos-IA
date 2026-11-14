/** HTTP downloads with progress, written atomically (.part then rename). */
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

export class HttpError extends Error {
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
