/**
 * Auto-clean: silences, filler words and repeated takes.
 * All functions return source-time ranges to cut for one clip instance.
 */
import type { Envelope, MainClip, Range, Word } from './types';
import { FRAME, mergeRanges } from './ranges';
import { endsSentence, fillerForm, levenshtein, normalizeWord } from './text';
import { wordRunRanges } from './edit';

const EPS = 1e-6;

const thresholdCache = new WeakMap<Envelope, number | null>();

/**
 * Adaptive silence threshold (envelope units = dBFS + 100) placed 30% of the
 * way from the noise floor (10th percentile) to the speech level (95th).
 * Returns null when the audio has no usable contrast.
 */
export function silenceThreshold(env: Envelope): number | null {
  if (thresholdCache.has(env)) return thresholdCache.get(env)!;
  const n = env.values.length;
  let result: number | null = null;
  if (n >= 50) {
    const hist = new Array(101).fill(0);
    for (let i = 0; i < n; i++) hist[env.values[i]]++;
    const pct = (p: number) => {
      let acc = 0;
      for (let v = 0; v <= 100; v++) {
        acc += hist[v];
        if (acc >= p * n) return v;
      }
      return 100;
    };
    const floor = pct(0.1);
    const speech = pct(0.95);
    if (speech - floor >= 12) result = Math.min(75, Math.max(40, floor + 0.3 * (speech - floor)));
  }
  thresholdCache.set(env, result);
  return result;
}

/** Runs of audio below the threshold lasting at least minDur seconds. */
export function detectAudioSilences(env: Envelope, window: Range, minDur: number): Range[] {
  const thr = silenceThreshold(env);
  if (thr === null) return [];
  const { rate, values } = env;
  const i0 = Math.max(0, Math.floor(window.start * rate));
  const i1 = Math.min(values.length, Math.ceil(window.end * rate));
  const out: Range[] = [];
  let runStart = -1;
  let loud = 0;
  const close = (endIdx: number) => {
    if (runStart >= 0 && (endIdx - runStart) / rate >= minDur) {
      out.push({ start: Math.max(window.start, runStart / rate), end: Math.min(window.end, endIdx / rate) });
    }
    runStart = -1;
  };
  for (let i = i0; i < i1; i++) {
    if (values[i] < thr) {
      if (runStart < 0) runStart = i;
      loud = 0;
    } else if (runStart >= 0) {
      // Tolerate clicks of up to 20 ms inside a silence.
      loud++;
      if (loud > 2) {
        close(i - loud + 1);
        loud = 0;
      }
    }
  }
  close(i1 - loud);
  return out;
}

/**
 * Pauses longer than `minSilence`, found both in the audio and in the gaps
 * between transcribed words. Whisper tends to drop hesitations, so a gap in
 * the transcript is treated as a pause too. `padding` seconds of breathing
 * room are kept next to speech.
 */
export function computeSilenceCuts(clip: MainClip, words: Word[], env: Envelope | undefined, minSilence: number, padding: number): Range[] {
  const candidates: Range[] = [];
  if (words.length) {
    let prevEnd = clip.start;
    for (const w of words) {
      if (w.start - prevEnd >= minSilence) candidates.push({ start: prevEnd, end: w.start });
      prevEnd = Math.max(prevEnd, w.end);
    }
    if (clip.end - prevEnd >= minSilence) candidates.push({ start: prevEnd, end: clip.end });
  }
  if (env) candidates.push(...detectAudioSilences(env, clip, minSilence));
  return mergeRanges(candidates)
    .map((r) => ({
      start: r.start <= clip.start + EPS ? clip.start : r.start + padding,
      end: r.end >= clip.end - EPS ? clip.end : r.end - padding,
    }))
    .filter((r) => r.end - r.start >= 2 * FRAME);
}

function fillerPatterns(fillers: string[]): string[][] {
  return fillers
    .map((f) => f.trim().split(/\s+/).map(fillerForm).filter(Boolean))
    .filter((p) => p.length > 0)
    .sort((a, b) => b.length - a.length);
}

/** Indices of words that are fillers (multi-word fillers such as "o sea" included). */
export function findFillerIndices(words: Word[], fillers: string[]): number[] {
  const patterns = fillerPatterns(fillers);
  const forms = words.map((w) => fillerForm(w.text));
  const out: number[] = [];
  for (let i = 0; i < words.length; i++) {
    for (const p of patterns) {
      if (p.every((tok, k) => forms[i + k] === tok)) {
        for (let k = 0; k < p.length; k++) out.push(i + k);
        i += p.length - 1;
        break;
      }
    }
  }
  return out;
}

export function computeFillerCuts(words: Word[], fillers: string[]): Range[] {
  return wordRunRanges(words, findFillerIndices(words, fillers));
}

export interface RetakeInput {
  clipId: string;
  words: Word[];
  /** Already removed words (by index) are ignored. */
  deleted: boolean[];
}

export interface RetakeResult {
  cuts: Map<string, Range[]>;
  takes: number;
  words: number;
}

interface Token {
  clip: number;
  index: number;
  norm: string;
}

interface Phrase {
  members: Token[];
  tokens: Token[];
}

function similarPrefix(a: string[], b: string[]): number {
  const k = Math.min(a.length, b.length);
  if (!k) return 0;
  return 1 - levenshtein(a.slice(0, k), b.slice(0, k)) / k;
}

/**
 * Detects repeated takes and keeps the last one:
 *  - phrase level: a phrase whose words match the beginning of one of the
 *    next three phrases is an abandoned take ("Hola a todos, hoy vamos a…
 *    Hola a todos, hoy vamos a hablar de…"). Short interjections between
 *    the takes ("perdón", "otra vez") go too.
 *  - inside a phrase: an immediately repeated run of 2+ words
 *    ("vamos a hablar vamos a hablar de…") keeps only the second run.
 */
export function computeRetakeCuts(clips: RetakeInput[], fillers: string[]): RetakeResult {
  const fillerSet = new Set(fillers.filter((f) => !/\s/.test(f.trim())).map(fillerForm));
  const phrases: Phrase[] = [];
  let current: Phrase | null = null;
  let prev: { clip: number; word: Word } | null = null;

  clips.forEach((c, ci) => {
    c.words.forEach((word, wi) => {
      if (c.deleted[wi]) return;
      const norm = normalizeWord(word.text);
      if (!norm) return;
      const brk = !current || !prev || prev.clip !== ci || endsSentence(prev.word.text) || word.start - prev.word.end >= 0.6;
      if (brk) {
        current = { members: [], tokens: [] };
        phrases.push(current);
      }
      const tok: Token = { clip: ci, index: wi, norm };
      current!.members.push(tok);
      if (!fillerSet.has(fillerForm(word.text))) current!.tokens.push(tok);
      prev = { clip: ci, word };
    });
  });

  const marked = new Set<string>();
  const mark = (t: Token) => marked.add(`${t.clip}:${t.index}`);
  let takes = 0;

  // Repeated runs inside a phrase.
  for (const p of phrases) {
    const toks = p.tokens.map((t) => t.norm);
    let i = 0;
    while (i < toks.length) {
      let found = false;
      for (let n = Math.min(8, Math.floor(toks.length / 2)); n >= 2 && !found; n--) {
        for (const gap of n >= 3 ? [0, 1] : [0]) {
          if (i + 2 * n + gap > toks.length) continue;
          const a = toks.slice(i, i + n);
          const b = toks.slice(i + n + gap, i + 2 * n + gap);
          const sim = similarPrefix(a, b);
          if (sim === 1 || (n >= 4 && sim >= 0.75)) {
            p.tokens.slice(i, i + n + gap).forEach(mark);
            takes++;
            i += n + gap;
            found = true;
            break;
          }
        }
      }
      if (!found) i++;
    }
  }

  // Abandoned takes across phrases.
  const remaining = (p: Phrase) => p.tokens.filter((t) => !marked.has(`${t.clip}:${t.index}`)).map((t) => t.norm);
  for (let i = 0; i < phrases.length; i++) {
    const a = remaining(phrases[i]);
    if (!a.length) continue;
    for (let j = i + 1; j <= Math.min(i + 3, phrases.length - 1); j++) {
      const b = remaining(phrases[j]);
      if (!b.length) continue;
      let match = false;
      if (a.length <= 2) match = j === i + 1 && b.length > a.length && a.every((t, k) => b[k] === t);
      else match = Math.min(a.length, b.length) >= 3 && similarPrefix(a, b) >= 0.75;
      if (match) {
        phrases[i].members.forEach(mark);
        for (let k = i + 1; k < j; k++) if (remaining(phrases[k]).length <= 3) phrases[k].members.forEach(mark);
        takes++;
        break;
      }
    }
  }

  const cuts = new Map<string, Range[]>();
  clips.forEach((c, ci) => {
    const idx = c.words.map((_, wi) => wi).filter((wi) => marked.has(`${ci}:${wi}`));
    if (idx.length) cuts.set(c.clipId, wordRunRanges(c.words, idx));
  });
  return { cuts, takes, words: marked.size };
}
