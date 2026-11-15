/**
 * The edited sequence is derived from the main clips: each clip instance
 * contributes its source range minus its cuts. Everything else (preview,
 * transcript state, subtitles, export) is computed from these segments.
 */
import type { CutReason, MainClip, ProjectDoc, Range, Word, WordOverride } from './types';
import { clipSpeed, wordKey } from './types';
import { FRAME, clamp, mergeRanges, overlap, quantize, subtractRanges } from './ranges';

const EPS = 1e-6;

export interface Segment {
  clipId: string;
  mediaId: string;
  clipIndex: number;
  /** Index of this kept range inside its clip. */
  rangeIndex: number;
  srcStart: number;
  srcEnd: number;
  tlStart: number;
  tlEnd: number;
  /** Playback speed chosen for the clip (1 = normal). */
  speed: number;
  /**
   * Source seconds per timeline second. It is the speed, adjusted so that the
   * segment (whose length is rounded to whole frames) maps exactly onto its
   * source range; exactly 1 at normal speed.
   */
  rate: number;
}

/** Kept source ranges of a clip, snapped to the 30 fps grid. */
export function keptRanges(clip: MainClip): Range[] {
  const lastFrame = Math.floor(clip.end * 30 + EPS) / 30;
  const kept = subtractRanges({ start: clip.start, end: clip.end }, clip.cuts).map((r) => ({
    start: quantize(r.start),
    end: r.end >= clip.end - EPS ? lastFrame : quantize(r.end),
  }));
  return mergeRanges(kept).filter((r) => r.end - r.start >= FRAME - EPS);
}

export function buildSegments(clips: MainClip[]): Segment[] {
  const segs: Segment[] = [];
  let t = 0;
  clips.forEach((clip, clipIndex) => {
    const speed = clipSpeed(clip);
    keptRanges(clip).forEach((r, rangeIndex) => {
      const tlEnd = Math.max(quantize(t + (r.end - r.start) / speed), quantize(t + FRAME));
      const rate = speed === 1 ? 1 : (r.end - r.start) / (tlEnd - t);
      segs.push({ clipId: clip.id, mediaId: clip.mediaId, clipIndex, rangeIndex, srcStart: r.start, srcEnd: r.end, tlStart: t, tlEnd, speed, rate });
      t = tlEnd;
    });
  });
  return segs;
}

export const sequenceDuration = (segs: Segment[]) => (segs.length ? segs[segs.length - 1].tlEnd : 0);

/** Index of the segment that plays at timeline time t (clamped). */
export function segmentIndexAt(segs: Segment[], t: number): number {
  if (!segs.length) return -1;
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].tlStart <= t + EPS) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function timelineToSource(segs: Segment[], t: number) {
  const index = segmentIndexAt(segs, t);
  if (index < 0) return null;
  const seg = segs[index];
  return { index, seg, src: seg.srcStart + clamp((t - seg.tlStart) * seg.rate, 0, seg.srcEnd - seg.srcStart) };
}

/**
 * Maps a source time of a clip instance to the timeline. With mode "next",
 * a time that falls inside a cut maps to the start of the following segment.
 */
export function sourceToTimeline(segs: Segment[], clipId: string, src: number, mode: 'exact' | 'next' = 'exact'): number | null {
  for (const seg of segs) {
    if (seg.clipId !== clipId || seg.srcEnd <= src + EPS) continue;
    if (seg.srcStart <= src + EPS) return seg.tlStart + Math.max(0, src - seg.srcStart) / seg.rate;
    return mode === 'next' ? seg.tlStart : null;
  }
  return null;
}

/** Words of a transcript that belong to a clip instance (by midpoint). */
export function wordsInClip(words: Word[] | undefined, clip: MainClip): Word[] {
  if (!words) return [];
  return words.filter((w) => {
    const mid = (w.start + w.end) / 2;
    return mid >= clip.start - EPS && mid < clip.end - EPS;
  });
}

export interface WordView {
  key: string;
  clipId: string;
  mediaId: string;
  /** Index inside the clip's word list. */
  index: number;
  word: Word;
  text: string;
  deleted: boolean;
  reason: CutReason | null;
  tlStart: number | null;
  tlEnd: number | null;
  hidden: boolean;
  breakBefore: boolean;
}

export interface ClipWords {
  clip: MainClip;
  clipIndex: number;
  words: Word[];
  views: WordView[];
}

/**
 * Resolves, for every transcript word of every clip instance, whether it was
 * cut and where it lands on the timeline.
 *
 * Silence cuts only delete a word when nothing of it survives: Whisper often
 * stretches a word over the pause that follows it, so a silence cut overlapping
 * the end of a word must not hide the word.
 */
export function buildClipWords(
  doc: Pick<ProjectDoc, 'clips' | 'words'>,
  transcripts: Record<string, Word[] | undefined>,
  segs: Segment[],
): ClipWords[] {
  return doc.clips.map((clip, clipIndex) => {
    const words = wordsInClip(transcripts[clip.mediaId], clip);
    const clipSegs = segs.filter((s) => s.clipId === clip.id);
    const hardCuts = mergeRanges(clip.cuts.filter((c) => c.reason !== 'silence'));
    const views = words.map((word, index): WordView => {
      const dur = Math.max(word.end - word.start, 0.01);
      let kept = 0;
      let tlStart: number | null = null;
      let tlEnd: number | null = null;
      for (const seg of clipSegs) {
        const o = overlap(word, { start: seg.srcStart, end: seg.srcEnd });
        if (o <= 0) continue;
        kept += o;
        if (tlStart === null) tlStart = seg.tlStart + (Math.max(word.start, seg.srcStart) - seg.srcStart) / seg.rate;
        tlEnd = seg.tlStart + (Math.min(word.end, seg.srcEnd) - seg.srcStart) / seg.rate;
      }
      const hardCovered = hardCuts.reduce((s, c) => s + overlap(word, c), 0);
      const deleted = kept < Math.min(0.05, dur * 0.5) || hardCovered > dur * 0.5;
      let reason: CutReason | null = null;
      if (deleted) {
        let best = 0;
        for (const c of clip.cuts) {
          const o = overlap(word, c) + (c.reason === 'silence' ? 0 : 1e-3);
          if (o > best) {
            best = o;
            reason = c.reason;
          }
        }
        reason ??= 'manual';
      }
      const key = wordKey(clip.mediaId, word.id);
      const ov: WordOverride | undefined = doc.words[key];
      return {
        key,
        clipId: clip.id,
        mediaId: clip.mediaId,
        index,
        word,
        text: ov?.text ?? word.text,
        deleted,
        reason,
        tlStart: deleted ? null : tlStart,
        tlEnd: deleted ? null : tlEnd,
        hidden: !!ov?.hidden,
        breakBefore: !!ov?.breakBefore,
      };
    });
    return { clip, clipIndex, words, views };
  });
}
