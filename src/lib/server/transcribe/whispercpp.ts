/**
 * Local transcription with whisper.cpp (`whisper-cli`). One word per segment
 * is requested (-ml 1 -sow) so every segment carries a word timestamp.
 */
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { config, whisperCppBinary, whisperCppModel } from '../config';
import { ffmpeg, runChecked } from '../ffmpeg';
import type { JobContext } from '../jobs';
import type { RawWord } from './align';

interface WhisperCppJson {
  transcription?: { offsets?: { from: number; to: number }; text?: string }[];
}

/** Parses whisper.cpp `-oj` output into words, merging stray punctuation. */
export function parseWhisperCppJson(data: WhisperCppJson): RawWord[] {
  const words: RawWord[] = [];
  for (const seg of data.transcription ?? []) {
    const text = (seg.text ?? '').trim();
    if (!text || !seg.offsets) continue;
    if (/^\[.*\]$|^\(.*\)$/.test(text)) continue; // [MÚSICA], (risas), [_BEG_]…
    const start = seg.offsets.from / 1000;
    const end = seg.offsets.to / 1000;
    const startsWord = /^\s/.test(seg.text ?? '') || !words.length;
    if (!/[\p{L}\p{N}]/u.test(text) || !startsWord) {
      const prev = words[words.length - 1];
      if (prev) {
        prev.word += text;
        prev.end = Math.max(prev.end, end);
      }
      continue;
    }
    words.push({ word: text, start, end });
  }
  return words;
}

export async function transcribeWhisperCpp(source: string, language: string, ctx: JobContext, tmp: string): Promise<RawWord[]> {
  const bin = whisperCppBinary();
  const model = whisperCppModel();
  if (!bin || !model) throw new Error('whisper.cpp no está configurado (WHISPER_CPP_BIN / WHISPER_CPP_MODEL)');
  const wav = path.join(tmp, 'audio.wav');
  const outBase = path.join(tmp, 'out');
  ctx.progress(0.02, 'Extrayendo audio');
  await ffmpeg(['-y', '-loglevel', 'error', '-i', source, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], { signal: ctx.signal });
  ctx.progress(0.05, 'Transcribiendo (whisper.cpp)');
  const args = [
    '-m',
    model,
    '-f',
    wav,
    '-l',
    language || 'auto',
    '-t',
    String(config.whisperThreads),
    '-oj',
    '-of',
    outBase,
    '-ml',
    '1',
    '-sow',
    '-pp',
  ];
  if (config.transcriptionPrompt) args.push('--prompt', config.transcriptionPrompt);
  await runChecked(bin, args, {
    signal: ctx.signal,
    onStderrLine: (line) => {
      const m = /progress\s*=\s*(\d+)%/.exec(line);
      if (m) ctx.progress(0.05 + (Number(m[1]) / 100) * 0.93);
    },
  });
  const data = JSON.parse(await readFile(`${outBase}.json`, 'utf8')) as WhisperCppJson;
  return parseWhisperCppJson(data);
}
