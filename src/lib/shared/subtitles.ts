/**
 * TikTok style subtitle layout shared by the preview overlay and the ASS
 * export: words are grouped in short pages and the active word is highlighted.
 */
import type { SubtitleStyle } from './types';
import type { ClipWords } from './timeline';
import { FRAME, clamp } from './ranges';
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
  /** Dragged edges of the block that starts or ends with this word (see WordOverride). */
  startOffset?: number;
  endOffset?: number;
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
/** Shortest a block can be made by dragging its edges. */
export const MIN_PAGE = 0.1;

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
        startOffset: v.startOffset,
        endOffset: v.endOffset,
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

  // Blocks never overlap: each one starts after the one before it has started…
  pages.forEach((p, k) => {
    const first = p.words[0];
    const start = Math.max(0, first.start + (first.startOffset ?? 0));
    p.start = k ? Math.max(start, pages[k - 1].start + FRAME) : start;
  });
  // …and ends, at the latest, where the next one begins.
  pages.forEach((p, k) => {
    const next = pages[k + 1];
    const last = p.words[p.words.length - 1];
    p.end = Math.max(p.start + FRAME, Math.min(last.end + (last.endOffset ?? HOLD), next ? next.start : Infinity));
    p.activeEnd = p.words.map((w, i) => (i < p.words.length - 1 ? Math.max(p.words[i + 1].start, w.start + 0.01) : p.end));
  });
  return pages;
}

export interface PageResize {
  /** New times of the dragged block and of the neighbour it pushes, by page index. */
  times: Map<number, { start: number; end: number }>;
  /** What to store in the overrides of the words at the moved edges. */
  offsets: { key: string; startOffset?: number; endOffset?: number }[];
}

/**
 * Moves the left or right edge of a block to the time `to`. The block next to
 * it gives way (it ends where this one starts, or starts where this one ends),
 * keeping at least MIN_PAGE of each. `limit` is the end of the video.
 */
export function resizePage(pages: SubPage[], index: number, edge: 'start' | 'end', to: number, limit = Infinity): PageResize | null {
  const page = pages[index];
  if (!page) return null;
  const times: PageResize['times'] = new Map();
  const offsets: PageResize['offsets'] = [];
  if (edge === 'start') {
    const prev = pages[index - 1];
    const first = page.words[0];
    const start = clamp(to, prev ? prev.start + MIN_PAGE : 0, Math.max(page.start, page.end - MIN_PAGE));
    times.set(index, { start, end: page.end });
    offsets.push({ key: first.key, startOffset: start - first.start });
    // The block before is cut short by itself: a block always ends where the next one starts.
    if (prev && start < prev.end) times.set(index - 1, { start: prev.start, end: start });
  } else {
    const next = pages[index + 1];
    const last = page.words[page.words.length - 1];
    const end = clamp(to, Math.min(page.end, page.start + MIN_PAGE), next ? Math.max(next.start, next.end - MIN_PAGE) : Math.max(limit, page.end));
    times.set(index, { start: page.start, end });
    offsets.push({ key: last.key, endOffset: end - last.end });
    if (next && end > next.start) {
      times.set(index + 1, { start: end, end: next.end });
      offsets.push({ key: next.words[0].key, startOffset: end - next.words[0].start });
    }
  }
  return { times, offsets };
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
