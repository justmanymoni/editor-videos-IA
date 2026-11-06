/**
 * OpenAI-compatible transcription (whisper-1, or any provider exposing the
 * same /audio/transcriptions endpoint with word timestamps, e.g. Groq).
 */
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { config } from '../config';
import { ffmpeg } from '../ffmpeg';
import type { JobContext } from '../jobs';
import { alignPunctuation, type RawSegment, type RawWord } from './align';

/** Long recordings are sent in pieces to stay under the 25 MB upload limit. */
const CHUNK_SECONDS = 20 * 60;

interface VerboseResponse {
  words?: RawWord[];
  segments?: RawSegment[];
  error?: { message?: string };
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('Cancelado'));
    });
  });

async function requestChunk(file: string, language: string, signal: AbortSignal): Promise<VerboseResponse> {
  const audio = await readFile(file);
  for (let attempt = 0; ; attempt++) {
    const form = new FormData();
    form.append('file', new Blob([audio], { type: 'audio/mp4' }), 'audio.m4a');
    form.append('model', config.openaiModel);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
    form.append('temperature', '0');
    if (language && language !== 'auto') form.append('language', language);
    if (config.transcriptionPrompt) form.append('prompt', config.transcriptionPrompt);

    const res = await fetch(`${config.openaiBaseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openaiKey}` },
      body: form,
      signal,
    });
    if (res.ok) return (await res.json()) as VerboseResponse;
    const body = (await res.json().catch(() => ({}))) as VerboseResponse;
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < 3) {
      await sleep(2000 * 2 ** attempt, signal);
      continue;
    }
    const hint = res.status === 401 ? ' (revisa OPENAI_API_KEY)' : '';
    throw new Error(`La API de transcripción respondió ${res.status}${hint}: ${body.error?.message ?? res.statusText}`);
  }
}

export async function transcribeOpenAI(source: string, duration: number, language: string, ctx: JobContext, tmp: string): Promise<RawWord[]> {
  const chunks: { start: number; length: number }[] = [];
  for (let s = 0; s < Math.max(duration, 0.1); s += CHUNK_SECONDS) chunks.push({ start: s, length: Math.min(CHUNK_SECONDS, duration - s) });

  const words: RawWord[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const { start, length } = chunks[i];
    const label = chunks.length > 1 ? ` (parte ${i + 1}/${chunks.length})` : '';
    ctx.progress(i / chunks.length + 0.05 / chunks.length, `Extrayendo audio${label}`);
    const file = path.join(tmp, `chunk-${i}.m4a`);
    await ffmpeg(
      [
        '-y',
        '-loglevel',
        'error',
        '-ss',
        String(start),
        '-t',
        String(length + 0.5),
        '-i',
        source,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'aac',
        '-b:a',
        '48k',
        file,
      ],
      { signal: ctx.signal },
    );
    ctx.progress(i / chunks.length + 0.15 / chunks.length, `Transcribiendo${label}`);
    const data = await requestChunk(file, language, ctx.signal);
    if (!data.words) throw new Error(`El modelo "${config.openaiModel}" no devolvió marcas de tiempo por palabra. Usa whisper-1.`);
    const aligned = alignPunctuation(data.words, data.segments ?? []);
    // Chunks overlap by 0.5 s: words starting inside the next chunk belong to it.
    const limit = i + 1 < chunks.length ? chunks[i + 1].start : Infinity;
    for (const w of aligned) {
      if (w.start + start >= limit) continue;
      words.push({ word: w.word, start: w.start + start, end: w.end + start });
    }
    ctx.progress((i + 1) / chunks.length);
  }
  return words;
}
