/**
 * Local transcription with whisper.cpp (`whisper-cli`). One word per segment
 * is requested (-ml 1 -sow) so every segment carries a word timestamp.
 */
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { config, whisperCppBinary, whisperCppModel } from '../config';
import { ffmpeg, run } from '../ffmpeg';
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
  const res = await run(bin, args, {
    signal: ctx.signal,
    onStderrLine: (line) => {
      const m = /progress\s*=\s*(\d+)%/.exec(line);
      if (m) ctx.progress(0.05 + (Math.min(100, Number(m[1])) / 100) * 0.93);
    },
  });
  if (res.code !== 0) {
    const detail = res.stderr.trim().split(/\r?\n/).slice(-3).join('\n');
    throw new Error(`${engineFailureMessage(res.code)}${detail ? `\n${detail}` : ''}`);
  }
  const data = JSON.parse(await readFile(`${outBase}.json`, 'utf8')) as WhisperCppJson;
  return parseWhisperCppJson(data);
}

/** Explains the usual reasons why whisper-cli cannot run. */
export function engineFailureMessage(code: number): string {
  // 0xC0000135 / 0xC000007B: missing or wrong DLL (Visual C++ runtime) on Windows.
  if ([3221225781, -1073741515, 3221225595, -1073741701].includes(code)) {
    return 'whisper.cpp no puede arrancar porque falta el «Microsoft Visual C++ Redistributable». Instálalo desde https://aka.ms/vs/17/release/vc_redist.x64.exe y vuelve a intentarlo.';
  }
  // 0xC000001D: illegal instruction (very old CPU).
  if ([3221225501, -1073741795].includes(code)) return 'Tu procesador no es compatible con esta versión de whisper.cpp.';
  return `whisper.cpp terminó con código ${code}.`;
}
