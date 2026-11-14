/** Plain text and subtitle files (SRT / WebVTT) of the edited video. */
import type { SubtitleStyle } from './types';
import type { ClipWords } from './timeline';
import { buildPages, collectSubWords, type SubPage } from './subtitles';
import { endsSentence } from './text';

/**
 * Text of what is said in the edited video (cut words excluded, corrections
 * applied). One paragraph per clip; set `includeCut` to get the full original.
 */
export function transcriptText(clipWords: ClipWords[], includeCut = false): string {
  const paragraphs: string[] = [];
  for (const cw of clipWords) {
    const words = cw.views.filter((v) => includeCut || !v.deleted).map((v) => v.text.trim());
    if (words.length) paragraphs.push(words.join(' '));
  }
  // Clips split from one recording continue the same sentence.
  return paragraphs.reduce((acc, p, i) => (i === 0 ? p : acc + (endsSentence(acc) ? '\n\n' : ' ') + p), '');
}

/** Readable caption layout for SRT/VTT, independent of the burned-in style. */
const CAPTION_STYLE: SubtitleStyle = {
  enabled: true,
  fontId: '',
  fontSize: 0,
  textColor: '',
  highlightColor: '',
  outlineColor: '',
  outlineWidth: 0,
  shadow: 0,
  positionY: 0,
  uppercase: false,
  stripPunctuation: false,
  wordsPerPage: 9,
  maxCharsPerLine: 42,
  activeScale: 1,
};

export function captionPages(clipWords: ClipWords[]): SubPage[] {
  return buildPages(collectSubWords(clipWords, CAPTION_STYLE), CAPTION_STYLE);
}

const stamp = (t: number, sep: ',' | '.') => {
  const ms = Math.max(0, Math.round(t * 1000));
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`;
};

const pageText = (p: SubPage) => p.lines.map((line) => line.map((i) => p.words[i].text).join(' ')).join('\n');

export function buildSrt(pages: SubPage[]): string {
  return pages.map((p, i) => `${i + 1}\n${stamp(p.start, ',')} --> ${stamp(p.end, ',')}\n${pageText(p)}\n`).join('\n');
}

export function buildVtt(pages: SubPage[]): string {
  return `WEBVTT\n\n${pages.map((p) => `${stamp(p.start, '.')} --> ${stamp(p.end, '.')}\n${pageText(p)}\n`).join('\n')}`;
}
