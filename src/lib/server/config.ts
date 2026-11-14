import path from 'node:path';
import os from 'node:os';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { WHISPER_MODEL_RANK } from '../shared/whisper-models';

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
    return Number(process.env.WHISPER_CPP_THREADS) || Math.max(2, Math.min(8, os.availableParallelism() - 1));
  },
  /** Where the app installs whisper.cpp and its models (storage/whisper). */
  get whisperDir() {
    return path.join(this.storageDir, 'whisper');
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

const BINARY_NAMES = ['whisper-cli', 'whisper-cpp'];

/** Looks for whisper-cli inside a folder (the engine the app installed). */
function findBinaryIn(dir: string, depth = 0): string | null {
  if (depth > 3 || !existsSync(dir)) return null;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isFile() && BINARY_NAMES.some((n) => e.name === n || e.name === `${n}.exe`)) return path.join(dir, e.name);
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const found = findBinaryIn(path.join(dir, e.name), depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** whisper.cpp executable: WHISPER_CPP_BIN, the copy installed by the app, or whisper-cli on PATH. */
export function whisperCppBinary(): string | null {
  const configured = process.env.WHISPER_CPP_BIN;
  if (configured) return existsSync(configured) ? configured : null;
  return findBinaryIn(path.join(config.whisperDir, 'bin')) ?? findOnPath(BINARY_NAMES);
}

const rankOf = (file: string) => {
  const r = WHISPER_MODEL_RANK.findIndex((x) => file.includes(x));
  return r < 0 ? 99 : r;
};

function bestModelIn(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => /^ggml-.*\.bin$/.test(f) && !f.startsWith('ggml-silero'))
    .sort((a, b) => rankOf(a) - rankOf(b));
  return files[0] ? path.join(dir, files[0]) : null;
}

/** Model chosen in the app's installer (storage/whisper/config.json), if still present. */
function preferredModel(): string | null {
  try {
    const { model } = JSON.parse(readFileSync(path.join(config.whisperDir, 'config.json'), 'utf8')) as { model?: string };
    const file = model && path.join(config.whisperDir, 'models', `ggml-${model}.bin`);
    return file && existsSync(/*turbopackIgnore: true*/ file) ? file : null;
  } catch {
    return null;
  }
}

/** whisper.cpp model: WHISPER_CPP_MODEL, the one chosen in the installer, or the best ggml-*.bin found. */
export function whisperCppModel(): string | null {
  const configured = process.env.WHISPER_CPP_MODEL;
  if (configured) return existsSync(configured) ? path.resolve(/*turbopackIgnore: true*/ root(), configured) : null;
  return (
    preferredModel() ?? bestModelIn(path.join(/*turbopackIgnore: true*/ root(), 'models')) ?? bestModelIn(path.join(config.whisperDir, 'models'))
  );
}

export type TranscriberKind = 'openai' | 'whispercpp' | 'none';

/**
 * Local transcription (whisper.cpp) is the default: it is free and needs no
 * API key. OpenAI is only used when TRANSCRIBER=openai or when there is a key
 * and no local engine installed.
 */
export function selectTranscriber(): { kind: TranscriberKind; detail: string } {
  const pref = config.transcriber;
  const hasOpenai = !!config.openaiKey;
  const bin = whisperCppBinary();
  const model = whisperCppModel();
  const openai = { kind: 'openai' as const, detail: `${config.openaiModel} · ${new URL(config.openaiBaseUrl).host}` };
  if (pref === 'openai') return hasOpenai ? openai : { kind: 'none', detail: 'TRANSCRIBER=openai pero falta OPENAI_API_KEY' };
  if (bin && model) return { kind: 'whispercpp', detail: `${path.basename(bin)} · ${path.basename(model)}` };
  if (pref !== 'whispercpp' && hasOpenai) return openai;
  if (bin && !model) return { kind: 'none', detail: 'Falta descargar el modelo de transcripción local' };
  return { kind: 'none', detail: 'Instala la transcripción local (gratis, sin API) desde la pantalla de inicio' };
}
