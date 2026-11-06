import { describe, expect, it } from 'vitest';
import type { MainClip, Word } from '@/lib/shared/types';
import { mergeRanges, subtractRanges, removeFromRanges } from '@/lib/shared/ranges';
import { buildClipWords, buildSegments, keptRanges, sequenceDuration, sourceToTimeline, timelineToSource } from '@/lib/shared/timeline';
import { detachRange, moveRange, splitClip, trimRange, wordRunRanges, addCuts, restoreRanges, splitItem } from '@/lib/shared/edit';

let n = 0;
const id = () => `id${++n}`;
const clip = (over: Partial<MainClip> = {}): MainClip => ({ id: 'c1', mediaId: 'm1', start: 0, end: 10, cuts: [], ...over });
const words: Word[] = [
  { id: 'w0', text: 'Hola', start: 0.5, end: 0.9 },
  { id: 'w1', text: 'a', start: 1.0, end: 1.1 },
  { id: 'w2', text: 'todos,', start: 1.2, end: 1.7 },
  { id: 'w3', text: 'eh,', start: 2.5, end: 2.8 },
  { id: 'w4', text: 'hoy', start: 3.0, end: 3.3 },
];

describe('ranges', () => {
  it('merges and subtracts', () => {
    expect(
      mergeRanges([
        { start: 2, end: 3 },
        { start: 0, end: 1 },
        { start: 0.5, end: 2 },
      ]),
    ).toEqual([{ start: 0, end: 3 }]);
    expect(
      subtractRanges({ start: 0, end: 10 }, [
        { start: 2, end: 3 },
        { start: 5, end: 6 },
      ]),
    ).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
      { start: 6, end: 10 },
    ]);
    expect(removeFromRanges([{ start: 0, end: 10 }], { start: 4, end: 6 })).toEqual([
      { start: 0, end: 4 },
      { start: 6, end: 10 },
    ]);
  });
});

describe('timeline', () => {
  it('builds frame-aligned segments and maps time both ways', () => {
    const c = clip({ cuts: [{ start: 2.01, end: 3.02, reason: 'silence' }] });
    const segs = buildSegments([c, clip({ id: 'c2', mediaId: 'm2', end: 5 })]);
    expect(segs).toHaveLength(3);
    expect(segs[0].srcEnd).toBeCloseTo(2, 6);
    expect(segs[1].srcStart).toBeCloseTo(3.0333333, 5);
    for (const s of segs) {
      expect(Math.abs(s.tlStart * 30 - Math.round(s.tlStart * 30))).toBeLessThan(1e-6);
      expect(Math.abs(s.srcStart * 30 - Math.round(s.srcStart * 30))).toBeLessThan(1e-6);
    }
    expect(sequenceDuration(segs)).toBeCloseTo(2 + (10 - 3.0333333) + 5, 4);
    const loc = timelineToSource(segs, 2.5)!;
    expect(loc.seg.clipId).toBe('c1');
    expect(loc.src).toBeCloseTo(3.5333333, 4);
    expect(sourceToTimeline(segs, 'c1', 2.5)).toBeNull();
    expect(sourceToTimeline(segs, 'c1', 2.5, 'next')).toBeCloseTo(2, 6);
    expect(sourceToTimeline(segs, 'c2', 1)).toBeCloseTo(2 + (10 - 3.0333333) + 1, 4);
  });

  it('ignores cuts shorter than a frame', () => {
    expect(keptRanges(clip({ cuts: [{ start: 5, end: 5.01, reason: 'manual' }] }))).toEqual([{ start: 0, end: 10 }]);
  });

  it('marks words as deleted only when really removed', () => {
    const c = clip({
      cuts: [
        { start: 1.2, end: 2.4, reason: 'manual' },
        { start: 3.2, end: 5, reason: 'silence' },
      ],
    });
    const segs = buildSegments([c]);
    const [cw] = buildClipWords({ clips: [c], words: {} }, { m1: words }, segs);
    const state = cw.views.map((v) => v.deleted);
    expect(state).toEqual([false, false, true, false, false]);
    expect(cw.views[2].reason).toBe('manual');
    // "hoy" keeps its audible start even though a silence cut overlaps its end.
    expect(cw.views[4].tlStart).toBeCloseTo(3.0 - 1.2, 1);
  });
});

describe('edit operations', () => {
  it('deletes a word together with the pause after it', () => {
    expect(wordRunRanges(words, [2])).toEqual([{ start: 1.2, end: 2.5 }]);
    expect(wordRunRanges(words, [0, 1, 4])).toEqual([
      { start: 0.5, end: 1.2 },
      { start: 3.0, end: 3.3 },
    ]);
    const cut = addCuts(clip(), wordRunRanges(words, [3]), 'manual');
    expect(cut.cuts).toEqual([{ start: 2.5, end: 3.0, reason: 'manual' }]);
    expect(restoreRanges(cut, wordRunRanges(words, [3])).cuts).toEqual([]);
  });

  it('splits clips and items', () => {
    const c = clip({ cuts: [{ start: 4, end: 6, reason: 'manual' }] });
    const [a, b] = splitClip(c, 5, id)!;
    expect(a).toMatchObject({ start: 0, end: 5, cuts: [{ start: 4, end: 5 }] });
    expect(b).toMatchObject({ start: 5, end: 10, cuts: [{ start: 5, end: 6 }] });
    expect(splitClip(c, 0, id)).toBeNull();
    const [x, y] = splitItem({ id: 'b', mediaId: 'm', start: 2, duration: 4, srcIn: 1 }, 3, id)!;
    expect(x.duration).toBe(1);
    expect(y).toMatchObject({ start: 3, duration: 3, srcIn: 2 });
  });

  it('trims kept ranges from either edge', () => {
    const c = clip({ cuts: [{ start: 4, end: 6, reason: 'manual' }] });
    expect(keptRanges(trimRange(c, 0, 'end', 3, 10))).toEqual([
      { start: 0, end: 3 },
      { start: 6, end: 10 },
    ]);
    expect(keptRanges(trimRange(c, 1, 'start', 5, 10))).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 10 },
    ]);
    const shortened = clip({ end: 8 });
    expect(trimRange(shortened, 0, 'end', 9.5, 10).end).toBe(9.5);
  });

  it('moves a range without changing other content', () => {
    const a = clip({ cuts: [{ start: 4, end: 6, reason: 'manual' }] });
    const b = clip({ id: 'c2', mediaId: 'm2', end: 3 });
    const before = buildSegments([a, b]);
    const detached = detachRange([a, b], 'c1', 1, id)!;
    const after = buildSegments(detached.clips);
    expect(after.map((s) => [s.srcStart, s.srcEnd])).toEqual(before.map((s) => [s.srcStart, s.srcEnd]));
    // Move "6..10" of clip 1 to the very end (after clip 2).
    const moved = moveRange([a, b], 'c1', 1, 100, id);
    const segs = buildSegments(moved);
    expect(segs.map((s) => `${s.mediaId}:${s.srcStart}-${s.srcEnd}`)).toEqual(['m1:0-4', 'm2:0-3', 'm1:6-10']);
    // And back to the start.
    const first = buildSegments(moveRange([a, b], 'c2', 0, 0, id));
    expect(first[0].mediaId).toBe('m2');
  });
});
