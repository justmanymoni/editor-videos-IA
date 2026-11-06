/** Keyword based B-roll suggestions: phrase keywords vs resource file names. */
import type { MediaInfo } from './types';
import type { ClipWords } from './timeline';
import { SPANISH_STOPWORDS, endsSentence, filenameKeywords, normalizeWord, stem } from './text';

export interface BrollSuggestion {
  id: string;
  text: string;
  start: number;
  end: number;
  mediaId: string;
  keywords: string[];
  score: number;
}

const stemsMatch = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a)));

export function suggestBroll(clipWords: ClipWords[], resources: MediaInfo[]): BrollSuggestion[] {
  const candidates = resources
    .filter((m) => m.status === 'ready' && (m.kind === 'video' || m.kind === 'image'))
    .map((m) => ({ media: m, stems: filenameKeywords(m.name).map(stem) }))
    .filter((r) => r.stems.length);
  if (!candidates.length) return [];

  type Phrase = { words: string[]; start: number; end: number };
  const phrases: Phrase[] = [];
  let cur: Phrase | null = null;
  for (const cw of clipWords) {
    for (const v of cw.views) {
      if (v.deleted || v.tlStart === null || v.tlEnd === null) continue;
      if (!cur || v.tlStart - cur.end > 0.6 || cur.words.length >= 14) {
        cur = { words: [], start: v.tlStart, end: v.tlEnd };
        phrases.push(cur);
      }
      cur.words.push(v.text);
      cur.end = v.tlEnd;
      if (endsSentence(v.text)) cur = null;
    }
  }

  const out: BrollSuggestion[] = [];
  phrases.forEach((p, i) => {
    const keywords = [...new Set(p.words.map(normalizeWord).filter((t) => t.length >= 4 && !SPANISH_STOPWORDS.has(t)))];
    const stems = keywords.map(stem);
    let best: { media: MediaInfo; score: number; hits: string[] } | null = null;
    for (const c of candidates) {
      const hits = keywords.filter((_, k) => c.stems.some((s) => stemsMatch(s, stems[k])));
      if (hits.length && (!best || hits.length > best.score)) best = { media: c.media, score: hits.length, hits };
    }
    if (best) {
      out.push({
        id: `s${i}-${best.media.id}`,
        text: p.words.join(' '),
        start: p.start,
        end: p.end,
        mediaId: best.media.id,
        keywords: best.hits,
        score: best.score,
      });
    }
  });
  return out;
}
