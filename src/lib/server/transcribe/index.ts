import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import type { Word } from '../../shared/types';
import { config, selectTranscriber } from '../config';
import type { JobContext } from '../jobs';
import type { MediaRecord } from '../media-store';
import { finalizeWords } from './align';
import { transcribeOpenAI } from './openai';
import { transcribeWhisperCpp } from './whispercpp';

export function transcribeMedia(rec: MediaRecord, language: string, ctx: JobContext) {
  return transcribeFile(rec.sourcePath, rec.duration, language, ctx);
}

/** Transcribes any audio or video file with the configured engine. */
export async function transcribeFile(
  sourcePath: string,
  duration: number,
  language: string,
  ctx: JobContext,
): Promise<{ words: Word[]; provider: string }> {
  const selected = selectTranscriber();
  if (selected.kind === 'none') throw new Error(selected.detail);
  const tmp = path.join(config.storageDir, 'tmp', `transcribe-${ctx.id}`);
  await mkdir(tmp, { recursive: true });
  try {
    const raw =
      selected.kind === 'openai'
        ? await transcribeOpenAI(sourcePath, duration, language, ctx, tmp)
        : await transcribeWhisperCpp(sourcePath, language, ctx, tmp);
    return { words: finalizeWords(raw), provider: selected.kind === 'openai' ? `openai:${config.openaiModel}` : 'whisper.cpp' };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
