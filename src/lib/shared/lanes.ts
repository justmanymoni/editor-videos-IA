/**
 * Rows ("lanes") inside a timeline track. Items that overlap in time are
 * placed one under another instead of hiding each other, which is what
 * allows several layers of text, overlays or audio at the same moment.
 */
export interface Lanes {
  /** Row of each item, by id (0 = first row). */
  of: Map<string, number>;
  /** Number of rows needed (at least 1). */
  count: number;
}

export function assignLanes(items: { id: string; start: number; duration: number }[]): Lanes {
  const of = new Map<string, number>();
  const ends: number[] = [];
  const sorted = [...items].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  for (const item of sorted) {
    let lane = ends.findIndex((end) => end <= item.start + 1e-3);
    if (lane < 0) lane = ends.length;
    ends[lane] = item.start + item.duration;
    of.set(item.id, lane);
  }
  return { of, count: Math.max(1, ends.length) };
}
