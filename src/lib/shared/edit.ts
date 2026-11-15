/**
 * Pure editing operations on the project document. The store wraps them with
 * undo history; tests exercise them directly.
 */
import type { Cut, CutReason, MainClip, Range, Word } from './types';
import { FRAME, clamp, clipRanges, removeFromRanges } from './ranges';
import { buildSegments, keptRanges } from './timeline';

export type IdFactory = () => string;

/**
 * Source ranges removed when deleting words: each run of consecutive words is
 * removed together with the pause that follows it, so the pause before the
 * run becomes the natural gap between the surrounding words.
 */
export function wordRunRanges(words: Word[], indices: Iterable<number>): Range[] {
  const sorted = [...new Set(indices)].filter((i) => i >= 0 && i < words.length).sort((a, b) => a - b);
  const ranges: Range[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    const first = words[sorted[i]];
    const last = words[sorted[j]];
    const next = words[sorted[j] + 1];
    const end = next ? Math.max(next.start, last.end) : last.end;
    ranges.push({ start: first.start, end });
    i = j + 1;
  }
  return ranges;
}

export function addCuts(clip: MainClip, ranges: Range[], reason: CutReason): MainClip {
  const added = clipRanges(ranges, clip).map((r): Cut => ({ start: r.start, end: r.end, reason }));
  return added.length ? { ...clip, cuts: [...clip.cuts, ...added] } : clip;
}

export function restoreRanges(clip: MainClip, ranges: Range[]): MainClip {
  let cuts = clip.cuts;
  for (const r of ranges) cuts = removeFromRanges(cuts, r);
  return { ...clip, cuts };
}

/** Replaces every cut with `reason` by a new set (used by auto-clean). */
export function replaceCuts(clip: MainClip, reason: CutReason, ranges: Range[]): MainClip {
  const others = clip.cuts.filter((c) => c.reason !== reason);
  return addCuts({ ...clip, cuts: others }, ranges, reason);
}

/** Splits a clip instance at a source time. Returns null if t is at an edge. */
export function splitClip(clip: MainClip, t: number, newId: IdFactory): [MainClip, MainClip] | null {
  if (t <= clip.start + FRAME || t >= clip.end - FRAME) return null;
  const a: MainClip = { ...clip, end: t, cuts: clipRanges(clip.cuts, { start: clip.start, end: t }) };
  const b: MainClip = { ...clip, id: newId(), start: t, cuts: clipRanges(clip.cuts, { start: t, end: clip.end }) };
  return [a, b];
}

/** Moves one edge of a kept range. `src` is the new source time of that edge. */
export function trimRange(clip: MainClip, rangeIndex: number, edge: 'start' | 'end', src: number, mediaDuration: number): MainClip {
  const ranges = keptRanges(clip);
  const r = ranges[rangeIndex];
  if (!r) return clip;
  if (edge === 'start') {
    const min = rangeIndex > 0 ? ranges[rangeIndex - 1].end : 0;
    const t = clamp(src, min, r.end - FRAME);
    if (t > r.start) return addCuts(clip, [{ start: r.start, end: t }], 'manual');
    if (t < r.start) {
      const restored = restoreRanges(clip, [{ start: t, end: r.start }]);
      return t < clip.start ? { ...restored, start: t } : restored;
    }
    return clip;
  }
  const max = rangeIndex < ranges.length - 1 ? ranges[rangeIndex + 1].start : mediaDuration;
  const t = clamp(src, r.start + FRAME, max);
  if (t < r.end) return addCuts(clip, [{ start: t, end: r.end }], 'manual');
  if (t > r.end) {
    const restored = restoreRanges(clip, [{ start: r.end, end: t }]);
    return t > clip.end ? { ...restored, end: t } : restored;
  }
  return clip;
}

const hasContent = (clip: MainClip) => keptRanges(clip).length > 0;

/**
 * Isolates one kept range into its own clip instance so it can be moved.
 * The timeline output does not change.
 */
export function detachRange(clips: MainClip[], clipId: string, rangeIndex: number, newId: IdFactory): { clips: MainClip[]; id: string } | null {
  const idx = clips.findIndex((c) => c.id === clipId);
  const clip = clips[idx];
  const r = clip && keptRanges(clip)[rangeIndex];
  if (!r) return null;
  const before: MainClip = { ...clip, id: newId(), end: r.start, cuts: clipRanges(clip.cuts, { start: clip.start, end: r.start }) };
  const mid: MainClip = { ...clip, start: r.start, end: r.end, cuts: clipRanges(clip.cuts, r) };
  const after: MainClip = { ...clip, id: newId(), start: r.end, cuts: clipRanges(clip.cuts, { start: r.end, end: clip.end }) };
  const parts = [before, mid, after].filter((c) => c === mid || (c.end - c.start > FRAME && hasContent(c)));
  return { clips: [...clips.slice(0, idx), ...parts, ...clips.slice(idx + 1)], id: mid.id };
}

/**
 * Moves a kept range so it plays at `dropTime` (timeline seconds): the range
 * is detached and re-inserted between the clip instances closest to that time.
 */
export function moveRange(clips: MainClip[], clipId: string, rangeIndex: number, dropTime: number, newId: IdFactory): MainClip[] {
  const detached = detachRange(clips, clipId, rangeIndex, newId);
  if (!detached) return clips;
  const segs = buildSegments(detached.clips);
  const spans = new Map<string, { start: number; end: number }>();
  for (const s of segs) {
    const span = spans.get(s.clipId);
    if (span) span.end = s.tlEnd;
    else spans.set(s.clipId, { start: s.tlStart, end: s.tlEnd });
  }
  const moving = detached.clips.find((c) => c.id === detached.id)!;
  const rest = detached.clips.filter((c) => c.id !== detached.id);
  let target = 0;
  for (let i = 0; i < rest.length; i++) {
    const span = spans.get(rest[i].id);
    if (span && (span.start + span.end) / 2 < dropTime) target = i + 1;
  }
  return [...rest.slice(0, target), moving, ...rest.slice(target)];
}

/** Anything placed on a timeline track: b-roll, audio or text. */
export type TimedItem = { id: string; start: number; duration: number; srcIn?: number };

/** Splits a b-roll, audio or text item at timeline time t. */
export function splitItem<T extends TimedItem>(item: T, t: number, newId: IdFactory): [T, T] | null {
  if (t <= item.start + FRAME || t >= item.start + item.duration - FRAME) return null;
  const offset = t - item.start;
  const second = { ...item, id: newId(), start: t, duration: item.duration - offset };
  if (item.srcIn !== undefined) second.srcIn = item.srcIn + offset;
  return [{ ...item, duration: offset }, second];
}

/** Removes the part of an item before (left) or after (right) timeline time t. */
export function trimItemAt<T extends TimedItem>(item: T, t: number, side: 'left' | 'right'): T | null {
  if (t <= item.start + FRAME || t >= item.start + item.duration - FRAME) return null;
  const offset = t - item.start;
  if (side === 'right') return { ...item, duration: offset };
  const trimmed = { ...item, start: t, duration: item.duration - offset };
  if (item.srcIn !== undefined) trimmed.srcIn = item.srcIn + offset;
  return trimmed;
}
