import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { errorMessage } from './jobs';

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  json: 'application/json',
  bin: 'application/octet-stream',
};

export const mimeFor = (file: string) => MIME[path.extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream';

export function errorResponse(err: unknown, status = 500) {
  return Response.json({ error: errorMessage(err) }, { status });
}

export const notFound = (what = 'No encontrado') => Response.json({ error: what }, { status: 404 });

/** Streams a file honouring HTTP Range requests (needed for <video> seeking). */
export async function sendFile(req: Request, file: string, opts: { contentType?: string; downloadName?: string; cache?: string } = {}) {
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return notFound('Archivo no encontrado');
  }
  const headers = new Headers({
    'Content-Type': opts.contentType ?? mimeFor(file),
    'Accept-Ranges': 'bytes',
    'Cache-Control': opts.cache ?? 'no-cache',
  });
  if (opts.downloadName) headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(opts.downloadName)}`);

  const range = req.headers.get('range');
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    start = Math.max(0, start);
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    headers.set('Content-Length', String(end - start + 1));
    const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new Response(req.method === 'HEAD' ? null : body, { status: 206, headers });
  }
  headers.set('Content-Length', String(size));
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(req.method === 'HEAD' ? null : body, { status: 200, headers });
}
