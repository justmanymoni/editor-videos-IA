import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';

/**
 * Runtime configuration from environment variables (.env.local).
 * Read lazily so changes in .env.local apply after a dev-server restart.
 */
const root = () => process.cwd();

export const config = {
  get storageDir() {
    return path.resolve(/*turbopackIgnore: true*/ root(), process.env.STORAGE_DIR || 'storage');
  },
  get resourcesDir() {
    return path.resolve(/*turbopackIgnore: true*/ root(), process.env.BROLL_DIR || 'recursos');
  },
  get fontsDir() {
    return path.join(/*turbopackIgnore: true*/ root(), 'public', 'fonts');
  },
  get ffmpeg() {
    return process.env.FFMPEG_PATH || 'ffmpeg';
  },
  get ffprobe() {
    return process.env.FFPROBE_PATH || 'ffprobe';
  },
  get defaultLanguage() {
    return process.env.DEFAULT_LANGUAGE || 'es';
  },
  get alwaysProxy() {
    return process.env.ALWAYS_PROXY === '1';
  },
  get openaiKey() {
    return process.env.OPENAI_API_KEY || '';
  },
  get openaiBaseUrl() {
    return (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  },
  get openaiModel() {
    return process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';
  },
  /** "openai", "whispercpp" or empty for automatic selection. */
  get transcriber() {
    return (process.env.TRANSCRIBER || '').toLowerCase();
  },
  get whisperThreads() {
    return Number(process.env.WHISPER_CPP_THREADS) || 4;
  },
  /** Words that help Whisper keep hesitations ("eh", "mm"…) in the transcript. */
  get transcriptionPrompt() {
    return process.env.TRANSCRIPTION_PROMPT ?? 'Eh… mm, o sea, bueno, pues eh… este, mmm, vale. Hola, ¿qué tal?';
  },
};

function findOnPath(names: string[]): string | null {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const name of names) {
    for (const dir of dirs) {
      for (const ext of exts) {
        const candidate = path.join(dir, name + ext);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

/** whisper.cpp binary: WHISPER_CPP_BIN or whisper-cli / whisper-cpp on PATH. */
export function whisperCppBinary(): string | null {
  const configured = process.env.WHISPER_CPP_BIN;
  if (configured) return existsSync(configured) ? configured : null;
  return findOnPath(['whisper-cli', 'whisper-cpp']);
}

/** whisper.cpp model: WHISPER_CPP_MODEL or the best ggml-*.bin inside ./models. */
export function whisperCppModel(): string | null {
  const configured = process.env.WHISPER_CPP_MODEL;
  if (configured) return existsSync(configured) ? path.resolve(/*turbopackIgnore: true*/ root(), configured) : null;
  const dir = path.join(/*turbopackIgnore: true*/ root(), 'models');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => /^ggml-.*\.bin$/.test(f));
  const rank = ['large-v3-turbo', 'large-v3', 'large', 'medium', 'small', 'base', 'tiny'];
  files.sort((a, b) => {
    const ra = rank.findIndex((r) => a.includes(r));
    const rb = rank.findIndex((r) => b.includes(r));
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
  });
  return files[0] ? path.join(dir, files[0]) : null;
}

export type TranscriberKind = 'openai' | 'whispercpp' | 'none';

export function selectTranscriber(): { kind: TranscriberKind; detail: string } {
  const pref = config.transcriber;
  const hasOpenai = !!config.openaiKey;
  const bin = whisperCppBinary();
  const model = whisperCppModel();
  const hasLocal = !!bin && !!model;
  if ((pref === 'openai' || !pref) && hasOpenai) return { kind: 'openai', detail: `${config.openaiModel} · ${new URL(config.openaiBaseUrl).host}` };
  if ((pref === 'whispercpp' || !pref) && hasLocal) return { kind: 'whispercpp', detail: `${path.basename(bin!)} · ${path.basename(model!)}` };
  if (pref === 'openai') return { kind: 'none', detail: 'TRANSCRIBER=openai pero falta OPENAI_API_KEY' };
  if (pref === 'whispercpp')
    return { kind: 'none', detail: !bin ? 'No se encuentra el binario de whisper.cpp' : 'No se encuentra el modelo ggml de whisper.cpp' };
  return { kind: 'none', detail: 'Configura OPENAI_API_KEY o whisper.cpp (ver README)' };
}
