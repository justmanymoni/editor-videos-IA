import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { nanoid } from 'nanoid';
import { config } from '@/lib/server/config';
import { probe } from '@/lib/server/ffmpeg';
import { errorResponse } from '@/lib/server/http';
import { transcribeFile } from '@/lib/server/transcribe';

/** POST ?lang=es — microphone recording as the raw body. Returns the recognised text. */
export async function POST(req: Request) {
  if (!req.body) return errorResponse(new Error('Falta el audio'), 400);
  const language = new URL(req.url).searchParams.get('lang') || config.defaultLanguage;
  const id = nanoid(10);
  const dir = path.join(config.storageDir, 'tmp', `dictate-${id}`);
  const file = path.join(dir, 'audio.webm');
  try {
    await mkdir(dir, { recursive: true });
    await pipeline(Readable.fromWeb(req.body as NodeReadableStream), createWriteStream(file));
    const { duration } = await probe(file);
    const { words } = await transcribeFile(file, duration, language, { id, signal: req.signal, progress: () => undefined });
    return Response.json({ text: words.map((w) => w.text).join(' ') });
  } catch (err) {
    return errorResponse(err, 400);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
