import type { Word } from '../../shared/types';
import { normalizeWord } from '../../shared/text';

export interface RawWord {
  word: string;
  start: number;
  end: number;
}

export interface RawSegment {
  text: string;
  start: number;
  end: number;
}

/**
 * OpenAI word timestamps come without punctuation or capitalisation, while the
 * segment text has both. Matches each word with the next segment token that
 * normalises to the same string and takes its written form.
 */
export function alignPunctuation(words: RawWord[], segments: RawSegment[]): RawWord[] {
  const tokens = segments.flatMap((s) => s.text.trim().split(/\s+/)).filter((t) => normalizeWord(t));
  let j = 0;
  return words.map((w) => {
    const norm = normalizeWord(w.word);
    for (let k = j; k < Math.min(tokens.length, j + 4); k++) {
      if (normalizeWord(tokens[k]) === norm) {
        j = k + 1;
        return { ...w, word: tokens[k] };
      }
    }
    return { ...w, word: w.word.trim() };
  });
}

/** Final clean-up shared by every provider: ids, ordering, sane times. */
export function finalizeWords(raw: RawWord[], prefix = 'w'): Word[] {
  const words = raw
    .map((w) => ({ text: w.word.trim(), start: Math.max(0, w.start), end: Math.max(w.start, w.end) }))
    .filter((w) => w.text && normalizeWord(w.text))
    .sort((a, b) => a.start - b.start);
  return words.map((w, i) => ({
    id: `${prefix}${i}`,
    text: w.text,
    start: Math.round(w.start * 1000) / 1000,
    end: Math.round(Math.max(w.end, w.start + 0.02) * 1000) / 1000,
  }));
}
