/**
 * TikTok style subtitle layout shared by the preview overlay and the ASS
 * export: words are grouped in short pages and the active word is highlighted.
 */
import type { SubtitleStyle } from './types';
import type { ClipWords } from './timeline';
import { FRAME } from './ranges';
import { endsSentence } from './text';

export interface SubWord {
  key: string;
  /** Text as shown (upper-cased, punctuation stripped…). */
  text: string;
  /** Text as written, before the style is applied (used when editing a block). */
  raw?: string;
  start: number;
  end: number;
  breakBefore: boolean;
  sentenceEnd: boolean;
}

export interface SubPage {
  index: number;
  words: SubWord[];
  /** Word indices per line. */
  lines: number[][];
  start: number;
  end: number;
  /** When the highlight of each word ends. */
  activeEnd: number[];
}

const MAX_LINES = 2;
const PAGE_GAP = 0.6;
const HOLD = 0.35;

export function subtitleText(text: string, style: Pick<SubtitleStyle, 'textCase' | 'stripPunctuation'>): string {
  let t = text.trim();
  if (style.stripPunctuation) t = t.replace(/[.,;:!?¡¿…"“”«»()]/g, '');
  if (style.textCase === 'upper') t = t.toLocaleUpperCase('es');
  else if (style.textCase === 'lower') t = t.toLocaleLowerCase('es');
  else if (style.textCase === 'title')
    t = t.toLocaleLowerCase('es').replace(/^(\P{L}*)(\p{L})/u, (_, lead: string, first: string) => lead + first.toLocaleUpperCase('es'));
  return t.trim();
}

export function collectSubWords(clipWords: ClipWords[], style: SubtitleStyle): SubWord[] {
  const out: SubWord[] = [];
  for (const cw of clipWords) {
    for (const v of cw.views) {
      if (v.deleted || v.hidden || v.tlStart === null || v.tlEnd === null) continue;
      const text = subtitleText(v.text, style);
      if (!text) continue;
      out.push({
        key: v.key,
        text,
        raw: v.text,
        start: v.tlStart,
        end: Math.max(v.tlEnd, v.tlStart + FRAME),
        breakBefore: v.breakBefore,
        sentenceEnd: endsSentence(v.text),
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function buildPages(words: SubWord[], style: Pick<SubtitleStyle, 'wordsPerPage' | 'maxCharsPerLine'>): SubPage[] {
  const pages: SubPage[] = [];
  let cur: SubWord[] = [];
  let lines: number[][] = [];
  let lineLen = 0;
  const maxChars = Math.max(4, style.maxCharsPerLine);
  const perPage = Math.max(1, style.wordsPerPage);

  const flush = () => {
    if (cur.length) pages.push({ index: pages.length, words: cur, lines, start: 0, end: 0, activeEnd: [] });
    cur = [];
    lines = [];
    lineLen = 0;
  };

  for (const w of words) {
    const prev = cur[cur.length - 1];
    let brk = !!prev && (w.breakBefore || cur.length >= perPage || w.start - prev.end > PAGE_GAP || prev.sentenceEnd);
    const fitsLine = lineLen === 0 || lineLen + 1 + w.text.length <= maxChars;
    if (!brk && prev && !fitsLine && lines.length >= MAX_LINES) brk = true;
    if (brk) flush();
    if (!lines.length || (lineLen > 0 && lineLen + 1 + w.text.length > maxChars)) {
      lines.push([]);
      lineLen = 0;
    }
    lines[lines.length - 1].push(cur.length);
    lineLen += (lineLen ? 1 : 0) + w.text.length;
    cur.push(w);
  }
  flush();

  for (const p of pages) p.start = p.words[0].start;
  pages.forEach((p, k) => {
    const next = pages[k + 1];
    const last = p.words[p.words.length - 1];
    p.end = Math.max(p.start + FRAME, Math.min(last.end + HOLD, next ? next.start : Infinity));
    p.activeEnd = p.words.map((w, i) => (i < p.words.length - 1 ? Math.max(p.words[i + 1].start, w.start + 0.01) : p.end));
  });
  return pages;
}

/** Page and word active at timeline time t. */
export function activeAt(pages: SubPage[], t: number): { page: number; word: number } | null {
  let lo = 0;
  let hi = pages.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pages[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found < 0) return null;
  const page = pages[found];
  if (t >= page.end) return null;
  let word = 0;
  for (let i = 0; i < page.words.length; i++) if (page.words[i].start <= t) word = i;
  return { page: found, word };
}
