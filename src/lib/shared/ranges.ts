import type { Range } from './types';
import { OUTPUT_FPS } from './types';

export const FRAME = 1 / OUTPUT_FPS;
const EPS = 1e-6;

/** Snaps a time to the output frame grid so exports are frame exact. */
export const quantize = (t: number) => Math.round(t * OUTPUT_FPS) / OUTPUT_FPS;

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const overlap = (a: Range, b: Range) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/** Sorts and merges overlapping or touching ranges. */
export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges.filter((r) => r.end - r.start > EPS).map((r) => ({ start: r.start, end: r.end }));
  sorted.sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + EPS) last.end = Math.max(last.end, r.end);
    else out.push(r);
  }
  return out;
}

/** base minus the union of `holes`. */
export function subtractRanges(base: Range, holes: Range[]): Range[] {
  const out: Range[] = [];
  let cursor = base.start;
  for (const h of mergeRanges(holes)) {
    if (h.end <= cursor) continue;
    if (h.start >= base.end) break;
    if (h.start > cursor) out.push({ start: cursor, end: Math.min(h.start, base.end) });
    cursor = Math.max(cursor, h.end);
  }
  if (cursor < base.end) out.push({ start: cursor, end: base.end });
  return out.filter((r) => r.end - r.start > EPS);
}

/** Removes `hole` from every range of the list, splitting where needed. */
export function removeFromRanges<T extends Range>(list: T[], hole: Range): T[] {
  const out: T[] = [];
  for (const r of list) {
    if (hole.end <= r.start || hole.start >= r.end) {
      out.push(r);
      continue;
    }
    if (hole.start > r.start + EPS) out.push({ ...r, end: hole.start });
    if (hole.end < r.end - EPS) out.push({ ...r, start: hole.end });
  }
  return out;
}

/** Keeps only the parts of each range inside `window`. */
export function clipRanges<T extends Range>(list: T[], window: Range): T[] {
  const out: T[] = [];
  for (const r of list) {
    const start = Math.max(r.start, window.start);
    const end = Math.min(r.end, window.end);
    if (end - start > EPS) out.push({ ...r, start, end });
  }
  return out;
}

export const totalLength = (ranges: Range[]) => ranges.reduce((s, r) => s + (r.end - r.start), 0);
