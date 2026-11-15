/**
 * Rows ("layers") inside a timeline track. Every item has a `lane`: items on
 * a higher lane sit further up and are drawn over the ones below. Inside a
 * lane, items that overlap in time are spread over neighbouring rows instead
 * of hiding each other.
 */
export interface LaneItem {
  id: string;
  start: number;
  duration: number;
  lane?: number;
}

export interface Lanes {
  /** Row of each item, by id (0 = the lowest layer). */
  of: Map<string, number>;
  /** Number of rows needed (at least 1). */
  count: number;
}

export interface LaneOptions {
  /** Lane of the items that have none. */
  defaultLane?: number;
  /** Row 0 always exists and only holds lane 0 (the subtitles' row of the text track). */
  reserved?: boolean;
}

/**
 * How each kind of item is stacked. The first row of the text track is the
 * subtitles' row; texts start one row above it unless they are dragged down.
 */
export const TEXT_LANES: LaneOptions = { defaultLane: 1, reserved: true };
export const OVERLAY_LANES: LaneOptions = {};
export const AUDIO_LANES: LaneOptions = {};

const laneOf = (item: LaneItem, fallback: number) => Math.max(0, Math.round(item.lane ?? fallback));
const overlaps = (a: LaneItem, b: LaneItem) => a.start < b.start + b.duration - 1e-3 && b.start < a.start + a.duration - 1e-3;

export function layoutLanes(items: LaneItem[], { defaultLane = 0, reserved = false }: LaneOptions = {}): Lanes {
  const of = new Map<string, number>();
  const groups = new Map<number, LaneItem[]>();
  for (const item of items) {
    const lane = laneOf(item, defaultLane);
    groups.set(lane, [...(groups.get(lane) ?? []), item]);
  }
  let row = reserved && !groups.has(0) ? 1 : 0;
  for (const lane of [...groups.keys()].sort((a, b) => a - b)) {
    const group = groups.get(lane)!.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    const ends: number[] = [];
    for (const item of group) {
      let sub = ends.findIndex((end) => end <= item.start + 1e-3);
      if (sub < 0) sub = ends.length;
      ends[sub] = item.start + item.duration;
      of.set(item.id, row + sub);
    }
    row += ends.length;
  }
  return { of, count: Math.max(1, row) };
}

/** Items in drawing order: lowest layer first, so that later ones cover earlier ones. */
export function byLayer<T extends LaneItem>(items: T[], options?: LaneOptions): T[] {
  const { of } = layoutLanes(items, options);
  return [...items].sort((a, b) => of.get(a.id)! - of.get(b.id)! || a.start - b.start);
}

/**
 * Lane of every item after `id` is dragged to row `targetRow`. The item joins
 * that row when it has room there; otherwise a new row is opened next to it
 * (above when the item was moved up, below when it was moved down). Dropping
 * above the top row makes a new top layer.
 */
export function moveToRow(items: LaneItem[], id: string, targetRow: number, options: LaneOptions = {}): Map<string, number> {
  const { of, count } = layoutLanes(items, options);
  const moved = items.find((x) => x.id === id);
  const lanes = new Map<string, number>([...of]);
  if (!moved) return lanes;
  const from = of.get(id)!;
  const target = Math.max(0, Math.min(Math.round(targetRow), count));
  const others = items.filter((x) => x.id !== id);
  const clash = others.some((x) => of.get(x.id) === target && overlaps(x, moved));
  if (!clash) {
    lanes.set(id, target);
    return lanes;
  }
  // No room in that row: open a new one beside it.
  const insertAt = target >= from ? target + 1 : target;
  for (const x of others) if (of.get(x.id)! >= insertAt) lanes.set(x.id, of.get(x.id)! + 1);
  lanes.set(id, insertAt);
  return lanes;
}

/** Kept for callers that only need rows for overlapping items. */
export const assignLanes = (items: LaneItem[]) => layoutLanes(items);
