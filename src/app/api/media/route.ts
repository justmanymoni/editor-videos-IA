import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { config } from '@/lib/server/config';
import { errorResponse } from '@/lib/server/http';
import { enqueueIngest, enqueueTranscribe, resumeInterrupted } from '@/lib/server/ingest';
import { IMAGE_EXT, VIDEO_EXT, extOf, getMedia, mediaPaths, newMediaId, registerFile, toPublic } from '@/lib/server/media-store';

export const dynamic = 'force-dynamic';

/** GET /api/media?ids=a,b — media records (restarts interrupted work). */
export async function GET(req: Request) {
  const ids = (new URL(req.url).searchParams.get('ids') ?? '').split(',').filter(Boolean).slice(0, 500);
  const out = [];
  for (const id of ids) {
    const rec = await getMedia(id);
    if (!rec) continue;
    await resumeInterrupted(rec);
    out.push(toPublic((await getMedia(id)) ?? rec));
  }
  return Response.json({ media: out });
}

/** POST /api/media?name=clip.mp4&lang=es — raw file body, streamed to disk. */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const name = path.basename(url.searchParams.get('name') || 'clip.mp4');
  const language = url.searchParams.get('lang') || config.defaultLanguage;
  const ext = extOf(name);
  if (![...VIDEO_EXT, ...IMAGE_EXT].includes(ext))
    return errorResponse(new Error(`Formato no admitido: .${ext || '?'} (usa mp4, mov, jpg o png)`), 415);
  if (!req.body) return errorResponse(new Error('Cuerpo vacío'), 400);

  const id = newMediaId();
  const paths = mediaPaths(id);
  const file = path.join(paths.dir, `source.${ext}`);
  try {
    await mkdir(paths.dir, { recursive: true });
    await pipeline(Readable.fromWeb(req.body as NodeReadableStream), createWriteStream(file));
    const rec = await registerFile({ id, filePath: file, name, role: 'clip', external: false });
    enqueueIngest(id);
    if (rec.hasAudio) await enqueueTranscribe(id, language);
    return Response.json({ media: toPublic((await getMedia(id)) ?? rec) });
  } catch (err) {
    await rm(paths.dir, { recursive: true, force: true });
    return errorResponse(err, 400);
  }
}
