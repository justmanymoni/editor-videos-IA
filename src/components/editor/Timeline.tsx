'use client';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { ArrowLeftToLine, ArrowRightToLine, Captions, Film, Layers, Maximize2, Music, Scissors, Trash2, Type, ZoomIn, ZoomOut } from 'lucide-react';
import type { AudioItem, BrollItem, Envelope, MediaInfo, TextItem } from '@/lib/shared/types';
import { FRAME, clamp } from '@/lib/shared/ranges';
import { sequenceDuration, type Segment } from '@/lib/shared/timeline';
import { filmstripRows, frameAt } from '@/lib/shared/filmstrip';
import { AUDIO_LANES, OVERLAY_LANES, TEXT_LANES, layoutLanes, moveToRow, type LaneOptions, type Lanes } from '@/lib/shared/lanes';
import { resizePage, type SubPage } from '@/lib/shared/subtitles';
import { mediaUrl } from '@/lib/client/api';
import { refKey, selRefs, selectionOf, toggleRef, useEditor, type SelRef, type Selection } from '@/lib/client/store';
import { useSegments, useSubtitlePages } from '@/lib/client/derived';
import { player, usePlayback } from '@/lib/client/player';
import { formatTime, mediaHue } from '@/lib/client/format';
import {
  addAudio,
  addBroll,
  deleteSelection,
  insertClip,
  moveItems,
  moveSegment,
  pickItems,
  resizeSubtitle,
  splitAtPlayhead,
  trimAtPlayhead,
  trimSegment,
  updateItem,
  updateItems,
  type ItemKind,
} from '@/lib/client/actions';
import { IconButton, Slider } from '@/components/ui';
import { MEDIA_DRAG_TYPE } from './ToolsPanel';

const H = { toolbar: 40, ruler: 24, text: 30, broll: 44, main: 62, audio: 40 };
type TrackId = 'text' | 'broll' | 'main' | 'audio';
const TRACK_ORDER: TrackId[] = ['text', 'broll', 'main', 'audio'];
/**
 * How the items of each track are stacked. The first row of the text track is
 * the subtitles' row; texts start one row above it unless they are dragged
 * down. Upper rows of text and overlays are drawn over lower ones.
 */
const LANE_OPTIONS: Record<ItemKind, LaneOptions> = { text: TEXT_LANES, broll: OVERLAY_LANES, audio: AUDIO_LANES };
/** Width, in pixels, of the zone on each edge of an element where it is stretched instead of moved. */
const EDGE = 8;
/** Cursors of an element: stretching by an edge (a bar with an arrow on each side) and moving. */
const TRIM_CURSOR = 'var(--cursor-trim)';
const SNAP_PX = 7;

/** Which edge of an element the pointer is on. Narrow elements keep a part in the middle to move them. */
function edgeAt(clientX: number, rect: DOMRect): 'start' | 'end' | null {
  const zone = Math.min(EDGE, rect.width * 0.3);
  if (clientX - rect.left < zone) return 'start';
  if (rect.right - clientX < zone) return 'end';
  return null;
}
const MIN_PPS = 4;
const MAX_PPS = 400;

type Item = BrollItem | AudioItem | TextItem;
const LIST = { broll: 'broll', audio: 'audio', text: 'texts' } as const;

type Drag =
  | { kind: 'scrub' }
  | { kind: 'seg-move'; seg: Segment; x0: number; dx: number; moved: boolean; t0: number }
  | { kind: 'seg-trim'; seg: Segment; edge: 'start' | 'end'; x0: number; dx: number }
  /** `row` is the layer the item is over while it is dragged up or down (`fromRow` is where it was). */
  | {
      kind: 'item-move';
      track: ItemKind;
      id: string;
      x0: number;
      y0: number;
      dx: number;
      moved: boolean;
      start: number;
      fromRow: number;
      row: number;
    }
  | { kind: 'item-trim'; track: ItemKind; id: string; edge: 'start' | 'end'; x0: number; dx: number }
  /** An edge of a subtitle block; the block next to it gives way. */
  | { kind: 'sub-trim'; page: number; edge: 'start' | 'end'; x0: number; dx: number }
  /** Selection box drawn on an empty part of the tracks (content pixels). `base` is what was selected before, when adding. */
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; moved: boolean; base: SelRef[] }
  /** Several selected items dragged together; `dt` is the shift in seconds. */
  | { kind: 'group-move'; x0: number; dx: number; moved: boolean; dt: number; anchor: SelRef & { id: string }; refs: SelRef[] };

const additive = (e: React.PointerEvent) => e.shiftKey || e.ctrlKey || e.metaKey;

function tickStep(pps: number) {
  for (const s of [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]) if (s * pps >= 64) return s;
  return 1200;
}

const Waveform = memo(function Waveform({
  env,
  from,
  to,
  width,
  height,
  color,
}: {
  env?: Envelope;
  from: number;
  to: number;
  width: number;
  height: number;
  color: string;
}) {
  const d = useMemo(() => {
    if (!env || width < 4) return '';
    const n = Math.min(Math.floor(width / 2), 2000);
    const top: string[] = [];
    const bottom: string[] = [];
    for (let i = 0; i <= n; i++) {
      const t = from + ((to - from) * i) / n;
      const v = env.values[Math.floor(t * env.rate)] ?? 0;
      const a = Math.max(0.03, Math.min(1, (v - 35) / 60)) * (height / 2);
      const x = ((width * i) / n).toFixed(1);
      top.push(`${x},${(height / 2 - a).toFixed(1)}`);
      bottom.unshift(`${x},${(height / 2 + a).toFixed(1)}`);
    }
    return `M${top.join('L')}L${bottom.join('L')}Z`;
  }, [env, from, to, width, height]);
  if (!d) return null;
  return (
    <svg width={width} height={height} className="pointer-events-none absolute bottom-0 left-0">
      <path d={d} fill={color} />
    </svg>
  );
});

function Playhead({ pps, scroller }: { pps: number; scroller: React.RefObject<HTMLDivElement | null> }) {
  const time = usePlayback((s) => s.time);
  const playing = usePlayback((s) => s.playing);
  const x = time * pps;
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, x - 80);
  }, [x, playing, scroller]);
  return (
    <div className="pointer-events-none absolute top-0 bottom-0 z-20" style={{ transform: `translateX(${x}px)` }}>
      <div className="absolute top-0 -left-[6px] h-3 w-3 rotate-45 rounded-[2px] bg-accent" />
      <div className="absolute top-0 bottom-0 left-0 w-px bg-accent" />
    </div>
  );
}

function TrackLabel({
  icon: Icon,
  label,
  height,
  layers = 1,
  plain,
}: {
  icon: typeof Film;
  label: string;
  height: number;
  layers?: number;
  /** No line underneath: the next label belongs to the same track. */
  plain?: boolean;
}) {
  return (
    <div className={clsx('flex items-center gap-1.5 px-3 text-[11px] font-medium text-muted', !plain && 'border-b border-line')} style={{ height }}>
      <Icon size={12} className="shrink-0" /> <span className="truncate">{label}</span>
      {layers > 1 && (
        <span className="ml-auto shrink-0 rounded bg-panel-3 px-1 text-[10px] text-faint" title={`${layers} capas a la vez`}>
          ×{layers}
        </span>
      )}
    </div>
  );
}

function nearest(points: number[], t: number) {
  return points.reduce((best, p) => (Math.abs(p - t) < Math.abs(best - t) ? p : best), points[0] ?? 0);
}

/** New start / duration / source offset when dragging an edge of an item by `dt` seconds. */
function trimItem(item: Item, m: MediaInfo | undefined, edge: 'start' | 'end', dt: number): { start?: number; duration?: number; srcIn?: number } {
  const srcIn = 'srcIn' in item ? item.srcIn : undefined;
  // Texts and photos have no source length: they can be stretched freely.
  const still = srcIn === undefined || !m || m.kind === 'image';
  const minDur = 0.2;
  if (edge === 'start') {
    const d = clamp(dt, -Math.min(item.start, still ? Infinity : srcIn), item.duration - minDur);
    const patch: { start: number; duration: number; srcIn?: number } = { start: item.start + d, duration: item.duration - d };
    if (srcIn !== undefined) patch.srcIn = still ? 0 : srcIn + d;
    return patch;
  }
  const maxExtra = still ? Infinity : m.duration - (srcIn + item.duration);
  return { duration: item.duration + clamp(dt, -(item.duration - minDur), maxExtra) };
}

export function Timeline({ height }: { height: number }) {
  const doc = useEditor((s) => s.doc)!;
  const media = useEditor((s) => s.media);
  const envelopes = useEditor((s) => s.envelopes);
  const selection = useEditor((s) => s.selection);
  const segs = useSegments();
  const pages = useSubtitlePages();
  const duration = sequenceDuration(segs);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [pps, setPps] = useState(60);
  const [drag, setDragState] = useState<Drag | null>(null);
  const [dropTrack, setDropTrack] = useState<'main' | 'broll' | 'audio' | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const fitted = useRef(false);
  // Tracks grow by one row for every extra layer of items that overlap in time.
  const lanes = useMemo<Record<ItemKind, Lanes>>(
    () => ({
      text: layoutLanes(doc.texts, LANE_OPTIONS.text),
      broll: layoutLanes(doc.broll, LANE_OPTIONS.broll),
      audio: layoutLanes(doc.audio, LANE_OPTIONS.audio),
    }),
    [doc.texts, doc.broll, doc.audio],
  );
  const rowsOf = (track: ItemKind) => lanes[track].count;
  /**
   * Top of a row inside its track. Text and overlays stack upwards (row 0 at
   * the bottom); audio stacks downwards. The row past the last one (a new
   * layer about to be made) is drawn on the last one, so nothing jumps while dragging.
   */
  const rowY = (track: ItemKind, row: number) => {
    const shown = Math.min(row, rowsOf(track) - 1);
    return (track === 'audio' ? shown : rowsOf(track) - 1 - shown) * H[track];
  };
  const rowHeight: Record<TrackId, number> = {
    text: H.text * rowsOf('text'),
    broll: H.broll * rowsOf('broll'),
    main: H.main,
    audio: H.audio * rowsOf('audio'),
  };
  const rowTop = {} as Record<TrackId, number>;
  let tracksHeight = H.ruler;
  for (const id of TRACK_ORDER) {
    rowTop[id] = tracksHeight;
    tracksHeight += rowHeight[id];
  }
  const live = useRef({ pps, segs, doc, media, duration, pages, lanes, rowTop, rowY });
  live.current = { pps, segs, doc, media, duration, pages, lanes, rowTop, rowY };
  const selectedKeys = useMemo(() => new Set(selRefs(selection).map(refKey)), [selection]);

  // Visible part of the timeline (the filmstrips only draw what can be seen).
  const [view, setView] = useState({ left: 0, width: 2400 });
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let raf = 0;
    const read = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() =>
        setView((v) => (v.left === el.scrollLeft && v.width === el.clientWidth ? v : { left: el.scrollLeft, width: el.clientWidth })),
      );
    };
    read();
    el.addEventListener('scroll', read, { passive: true });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', read);
      ro.disconnect();
    };
  }, []);

  const fit = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setPps(clamp((el.clientWidth - 48) / Math.max(live.current.duration, 1), MIN_PPS, MAX_PPS));
    el.scrollLeft = 0;
  }, []);

  useLayoutEffect(() => {
    if (!fitted.current && duration > 0) {
      fitted.current = true;
      fit();
    }
  }, [duration, fit]);

  // Ctrl/Cmd + wheel zooms around the pointer.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const t = (e.clientX - rect.left + el.scrollLeft) / live.current.pps;
      const next = clamp(live.current.pps * Math.exp(-e.deltaY * 0.0025), MIN_PPS, MAX_PPS);
      setPps(next);
      requestAnimationFrame(() => (el.scrollLeft = t * next - (e.clientX - rect.left)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const timeAt = (clientX: number) => {
    const el = scroller.current!;
    return Math.max(0, (clientX - el.getBoundingClientRect().left + el.scrollLeft) / live.current.pps);
  };

  const itemsOf = (track: ItemKind) => live.current.doc[LIST[track]] as Item[];

  const snapPoints = (exclude: Set<string>) => {
    const { segs: s, doc: d } = live.current;
    const pts = [0, usePlayback.getState().time, sequenceDuration(s)];
    for (const seg of s) pts.push(seg.tlStart);
    for (const b of [...d.broll, ...d.audio, ...d.texts]) if (!exclude.has(b.id)) pts.push(b.start, b.start + b.duration);
    return pts;
  };
  /** Start for an item dragged to `start`, pulled to the nearest edge of another element. */
  const snapItem = (start: number, length: number, pts: number[]) => {
    const byStart = snap(start, pts);
    return byStart !== start ? byStart : snap(start + length, pts) - length;
  };

  /** Pointer position inside the scrolling content, in pixels. */
  const pointAt = (e: { clientX: number; clientY: number }) => {
    const r = content.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** Every element touched by a box drawn on the tracks. */
  const elementsIn = (ax: number, ay: number, bx: number, by: number): SelRef[] => {
    const { pps: p, segs: sg, doc: d, pages: pg, lanes: ln, rowTop: tops, rowY: yOf } = live.current;
    const from = Math.min(ax, bx) / p;
    const to = Math.max(ax, bx) / p;
    const top = Math.min(ay, by);
    const bottom = Math.max(ay, by);
    const band = (y: number, height: number) => top < y + height && bottom > y;
    /** The row of one item inside a track with several layers. */
    const lane = (k: ItemKind, id: string) => band(tops[k] + yOf(k, ln[k].of.get(id) ?? 0), H[k]);
    const over = (start: number, end: number) => start < to && end > from;
    const out: SelRef[] = [];
    for (const x of d.texts) if (over(x.start, x.start + x.duration) && lane('text', x.id)) out.push({ kind: 'text', id: x.id });
    // The subtitles live on the first row of the text track.
    if (d.subtitles.enabled && band(tops.text + yOf('text', 0), H.text))
      for (const x of pg) if (over(x.start, x.end)) out.push({ kind: 'subtitle', page: x.index });
    for (const x of d.broll) if (over(x.start, x.start + x.duration) && lane('broll', x.id)) out.push({ kind: 'broll', id: x.id });
    if (band(tops.main, H.main))
      for (const x of sg) if (over(x.tlStart, x.tlEnd)) out.push({ kind: 'segment', clipId: x.clipId, rangeIndex: x.rangeIndex });
    for (const x of d.audio) if (over(x.start, x.start + x.duration) && lane('audio', x.id)) out.push({ kind: 'audio', id: x.id });
    return out;
  };
  const snap = (t: number, pts: number[]) => {
    let best = t;
    let dist = 8 / live.current.pps;
    for (const p of pts) if (Math.abs(p - t) < dist) [best, dist] = [p, Math.abs(p - t)];
    return best;
  };

  /**
   * Where the dragged edge of a subtitle is: it sticks to the playhead and to
   * the edge of the block next to it, so one can end exactly where the other starts.
   */
  const subEdgeTime = (d: Extract<Drag, { kind: 'sub-trim' }>): number | null => {
    const { pages: list, pps: p } = live.current;
    const page = list[d.page];
    if (!page) return null;
    const t = (d.edge === 'start' ? page.start : page.end) + d.dx / p;
    const near = [usePlayback.getState().time, d.edge === 'start' ? list[d.page - 1]?.end : list[d.page + 1]?.start];
    for (const pt of near) if (pt !== undefined && Math.abs(pt - t) * p < SNAP_PX) return pt;
    return t;
  };

  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };

  const finish = useCallback(() => {
    const d = dragRef.current;
    const { pps: p, media: md } = live.current;
    setDrag(null);
    if (!d) return;
    const dt = ('dx' in d ? d.dx : 0) / p;
    if (d.kind === 'seg-trim' && Math.abs(d.dx) > 1) {
      // The drag is measured on the timeline; the clip is trimmed in its own (source) time.
      trimSegment(d.seg.clipId, d.seg.rangeIndex, d.edge, (d.edge === 'start' ? d.seg.srcStart : d.seg.srcEnd) + dt * d.seg.rate);
    } else if (d.kind === 'seg-move') {
      if (d.moved) moveSegment(d.seg.clipId, d.seg.rangeIndex, (d.seg.tlStart + d.seg.tlEnd) / 2 + dt);
      else {
        player.pause();
        player.seek(d.t0);
      }
    } else if (d.kind === 'marquee' && !d.moved) {
      // A plain click on an empty part: drop the selection and move the playhead there, stopped.
      if (!d.base.length) useEditor.getState().setSelection(null);
      player.pause();
      player.seek(d.x0 / p);
    } else if (d.kind === 'group-move') {
      if (d.moved) moveItems(d.refs, d.dt);
      else useEditor.getState().setSelection(d.anchor);
    } else if (d.kind === 'item-move' && d.moved) {
      const start = Math.max(0, d.start);
      if (d.row === d.fromRow) updateItem(d.track, d.id, { start });
      else {
        // Dropped on another layer: the rows are renumbered so the item lands exactly there.
        const list = itemsOf(d.track).map((x) => (x.id === d.id ? { ...x, start } : x));
        const next = moveToRow(list, d.id, d.row, LANE_OPTIONS[d.track]);
        updateItems(
          list
            .filter((x) => x.id === d.id || next.get(x.id) !== x.lane)
            .map((x) => ({ kind: d.track, id: x.id, patch: x.id === d.id ? { start, lane: next.get(x.id) } : { lane: next.get(x.id) } })),
        );
      }
    } else if (d.kind === 'item-trim' && Math.abs(d.dx) > 1) {
      const item = itemsOf(d.track).find((x) => x.id === d.id);
      if (item) updateItem(d.track, d.id, trimItem(item, 'mediaId' in item ? md[item.mediaId] : undefined, d.edge, dt));
    } else if (d.kind === 'sub-trim' && Math.abs(d.dx) > 1) {
      const to = subEdgeTime(d);
      if (to !== null) resizeSubtitle(d.page, d.edge, to);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.kind === 'scrub') return player.seek(timeAt(e.clientX));
      if (d.kind === 'marquee') {
        const pt = pointAt(e);
        const moved = d.moved || Math.hypot(pt.x - d.x0, pt.y - d.y0) > 4;
        if (moved) useEditor.getState().setSelection(selectionOf([...d.base, ...elementsIn(d.x0, d.y0, pt.x, pt.y)]));
        return setDrag({ ...d, x1: pt.x, y1: pt.y, moved });
      }
      const dx = e.clientX - d.x0;
      if (d.kind === 'group-move') {
        const items = pickItems(live.current.doc, d.refs);
        if (!items.length) return;
        const floor = -Math.min(...items.map((x) => x.item.start));
        let dt = Math.max(dx / live.current.pps, floor);
        const anchor = items.find((x) => x.item.id === d.anchor.id)?.item;
        if (anchor) {
          const pts = snapPoints(new Set(items.map((x) => x.item.id)));
          dt = Math.max(snapItem(anchor.start + dt, anchor.duration, pts) - anchor.start, floor);
        }
        setDrag({ ...d, dx, dt, moved: d.moved || Math.abs(dx) > 3 });
      } else if (d.kind === 'item-move') {
        const item = itemsOf(d.track).find((x) => x.id === d.id);
        if (!item) return;
        const start = snapItem(Math.max(0, item.start + dx / live.current.pps), item.duration, snapPoints(new Set([d.id])));
        // Up or down by whole rows. Above the top row of text and overlays (below the last one of audio) is a new layer.
        const dy = e.clientY - d.y0;
        const steps = Math.round(dy / H[d.track]) * (d.track === 'audio' ? 1 : -1);
        const row = clamp(d.fromRow + steps, 0, live.current.lanes[d.track].count);
        setDrag({ ...d, dx, moved: d.moved || Math.abs(dx) > 3 || row !== d.fromRow, start: Math.max(0, start), row });
      } else if (d.kind === 'seg-move') setDrag({ ...d, dx, moved: d.moved || Math.abs(dx) > 4 });
      else setDrag({ ...d, dx });
    };
    // The cursor of the gesture is kept all over the window until it ends.
    const kind = dragRef.current?.kind ?? '';
    const cursor = kind.endsWith('-trim') ? 'trim' : kind.endsWith('-move') ? 'move' : '';
    if (cursor) document.body.dataset.dragCursor = cursor;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    return () => {
      delete document.body.dataset.dragCursor;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null, finish]);

  const select = (sel: Selection) => useEditor.getState().setSelection(sel);
  const edgeOf = (e: React.PointerEvent, el: HTMLElement) => edgeAt(e.clientX, el.getBoundingClientRect());

  const onSegDown = (e: React.PointerEvent, seg: Segment) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const ref: SelRef = { kind: 'segment', clipId: seg.clipId, rangeIndex: seg.rangeIndex };
    if (additive(e)) return select(toggleRef(useEditor.getState().selection, ref));
    select(ref);
    const edge = edgeOf(e, e.currentTarget as HTMLElement);
    if (edge) setDrag({ kind: 'seg-trim', seg, edge, x0: e.clientX, dx: 0 });
    else setDrag({ kind: 'seg-move', seg, x0: e.clientX, dx: 0, moved: false, t0: timeAt(e.clientX) });
  };

  const onItemDown = (e: React.PointerEvent, track: ItemKind, item: Item) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const ref: SelRef & { id: string } = { kind: track, id: item.id };
    const sel = useEditor.getState().selection;
    if (additive(e)) return select(toggleRef(sel, ref));
    // Dragging one of several selected items moves them all; a plain click keeps only that one.
    if (sel?.kind === 'multi' && sel.items.some((r) => refKey(r) === refKey(ref))) {
      return setDrag({ kind: 'group-move', x0: e.clientX, dx: 0, moved: false, dt: 0, anchor: ref, refs: sel.items });
    }
    select(ref);
    const edge = edgeOf(e, e.currentTarget as HTMLElement);
    if (edge) setDrag({ kind: 'item-trim', track, id: item.id, edge, x0: e.clientX, dx: 0 });
    else {
      const row = live.current.lanes[track].of.get(item.id) ?? 0;
      setDrag({ kind: 'item-move', track, id: item.id, x0: e.clientX, y0: e.clientY, dx: 0, moved: false, start: item.start, fromRow: row, row });
    }
  };

  const onSubDown = (e: React.PointerEvent, page: SubPage) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const ref: SelRef = { kind: 'subtitle', page: page.index };
    if (additive(e)) return select(toggleRef(useEditor.getState().selection, ref));
    select(ref);
    const edge = edgeOf(e, e.currentTarget as HTMLElement);
    if (edge) return setDrag({ kind: 'sub-trim', page: page.index, edge, x0: e.clientX, dx: 0 });
    // Seek to the clicked point so S can split the block right there.
    const r = e.currentTarget.getBoundingClientRect();
    player.seek(page.start + ((e.clientX - r.left) / Math.max(1, r.width)) * (page.end - page.start));
  };

  /** The ruler moves the playhead. The selection is kept, so several elements can then be split or trimmed there. */
  const onRulerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Moving the playhead stops playback: the video stays where it is dropped.
    player.pause();
    player.seek(timeAt(e.clientX));
    setDrag({ kind: 'scrub' });
  };

  /** An empty part of a track: a click moves the playhead, dragging draws a box that selects what it touches. */
  const onEmptyDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const pt = pointAt(e);
    const base = additive(e) ? selRefs(useEditor.getState().selection) : [];
    setDrag({ kind: 'marquee', x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y, moved: false, base });
  };

  /** Media dragged from the panel: videos and photos go to the main or overlay track, audio to the audio track. */
  const dropHandlers = (track: 'main' | 'broll' | 'audio') => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(MEDIA_DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDropTrack(track);
    },
    onDragLeave: () => setDropTrack(null),
    onDrop: (e: React.DragEvent) => {
      setDropTrack(null);
      const id = e.dataTransfer.getData(MEDIA_DRAG_TYPE);
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      const m = useEditor.getState().media[id];
      if (!m) return;
      const t = timeAt(e.clientX);
      if (m.kind === 'audio') addAudio(m, t);
      else if (track === 'main') insertClip(m, t);
      else if (track === 'broll') addBroll(m, t);
      else useEditor.getState().toast('La pista de audio es solo para música y sonido. Suelta el vídeo o la foto en otra pista.');
    },
  });

  const width = (Math.max(duration, 5) + 6) * pps;
  const step = tickStep(pps);
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let t = 0; t <= width / pps; t += step) out.push(t);
    return out;
  }, [width, pps, step]);

  // Clip boundaries (for the move indicator).
  const clipBoundaries = useMemo(() => {
    const out = [0];
    segs.forEach((s, i) => {
      if (i > 0 && segs[i - 1].clipIndex !== s.clipIndex) out.push(s.tlStart);
    });
    out.push(duration);
    return out;
  }, [segs, duration]);

  // While an edge of a subtitle is dragged: the new times of that block and of the one it pushes.
  const subDragTo = drag?.kind === 'sub-trim' ? subEdgeTime(drag) : null;
  const subResize = drag?.kind === 'sub-trim' && subDragTo !== null ? resizePage(pages, drag.page, drag.edge, subDragTo, duration) : null;
  const moveMarker =
    drag?.kind === 'seg-move' && drag.moved ? nearest(clipBoundaries, (drag.seg.tlStart + drag.seg.tlEnd) / 2 + drag.dx / pps) : null;
  const itemTrack = (track: ItemKind, items: Item[], hint: string, extra?: object, under?: React.ReactNode) => (
    <div
      data-track={track}
      data-rows={lanes[track].count}
      className={clsx('relative border-b border-line', dropTrack === track && 'bg-accent/10')}
      style={{ height: rowHeight[track] }}
      onPointerDown={onEmptyDown}
      {...extra}
    >
      {/* Faint lines between layers, and the row an item is being dragged to. */}
      {Array.from({ length: rowsOf(track) - 1 }, (_, i) => (
        <div key={i} className="pointer-events-none absolute inset-x-0 border-t border-line/60" style={{ top: (i + 1) * H[track] }} />
      ))}
      {drag?.kind === 'item-move' &&
        drag.track === track &&
        drag.moved &&
        drag.row !== drag.fromRow &&
        (drag.row >= rowsOf(track) ? (
          // Past the last row: a line where the new layer will appear.
          <div
            data-new-layer
            className={clsx('pointer-events-none absolute inset-x-0 z-20 h-[3px] bg-accent', track === 'audio' ? 'bottom-0' : 'top-0')}
          />
        ) : (
          <div className="pointer-events-none absolute inset-x-0 bg-accent/10" style={{ top: rowY(track, drag.row), height: H[track] }} />
        ))}
      {under}
      {items.map((item) => {
        const dragged = drag?.kind === 'item-move' && drag.id === item.id && drag.moved;
        return (
          <ItemBlock
            key={item.id}
            item={item}
            track={track}
            media={'mediaId' in item ? media[item.mediaId] : undefined}
            env={track === 'audio' && 'mediaId' in item ? envelopes[item.mediaId] : undefined}
            pps={pps}
            drag={drag}
            top={rowY(track, dragged ? drag.row : (lanes[track].of.get(item.id) ?? 0))}
            selected={selectedKeys.has(`${track}:${item.id}`)}
            onDown={onItemDown}
          />
        );
      })}
      {!items.length && !under && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[11px] text-faint">{hint}</span>}
    </div>
  );

  return (
    <section data-timeline className="flex shrink-0 flex-col bg-panel select-none" style={{ height }}>
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2" style={{ height: H.toolbar }}>
        <IconButton label="Dividir en el cursor (S)" onClick={splitAtPlayhead}>
          <Scissors size={15} />
        </IconButton>
        <IconButton label="Borrar lo que queda a la izquierda del cursor (Q)" onClick={() => trimAtPlayhead('left')}>
          <ArrowLeftToLine size={15} />
        </IconButton>
        <IconButton label="Borrar lo que queda a la derecha del cursor (W)" onClick={() => trimAtPlayhead('right')}>
          <ArrowRightToLine size={15} />
        </IconButton>
        <IconButton label="Eliminar el elemento seleccionado (Supr)" onClick={deleteSelection} disabled={!selection}>
          <Trash2 size={15} />
        </IconButton>
        <div className="mx-2 h-5 w-px bg-line" />
        <span className="min-w-0 flex-1 truncate text-[11px] text-faint">
          {selectedKeys.size > 1
            ? `${selectedKeys.size} elementos seleccionados · arrastra uno para moverlos todos · Supr los elimina`
            : 'Arrastra en un hueco para seleccionar varios elementos · Ctrl + clic añade o quita · arrastra los bordes para recortar'}
        </span>
        <IconButton label="Alejar" onClick={() => setPps((p) => clamp(p / 1.4, MIN_PPS, MAX_PPS))}>
          <ZoomOut size={15} />
        </IconButton>
        <div className="w-28">
          <Slider value={Math.log(pps)} min={Math.log(MIN_PPS)} max={Math.log(MAX_PPS)} step={0.01} onChange={(v) => setPps(Math.exp(v))} />
        </div>
        <IconButton label="Acercar" onClick={() => setPps((p) => clamp(p * 1.4, MIN_PPS, MAX_PPS))}>
          <ZoomIn size={15} />
        </IconButton>
        <IconButton label="Ajustar al ancho" onClick={fit}>
          <Maximize2 size={14} />
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1 overflow-y-auto">
        <div className="w-32 shrink-0 border-r border-line" style={{ minHeight: tracksHeight }}>
          <div style={{ height: H.ruler }} className="border-b border-line" />
          {/* The text track: titles on the upper rows, the subtitles' row at the bottom. */}
          {rowsOf('text') > 1 && <TrackLabel icon={Type} label="Texto" height={H.text * (rowsOf('text') - 1)} layers={lanes.text.count - 1} plain />}
          <TrackLabel icon={Captions} label="Subtítulos" height={H.text} />
          <TrackLabel icon={Layers} label="Superposición" height={rowHeight.broll} layers={lanes.broll.count} />
          <TrackLabel icon={Film} label="Vídeo" height={rowHeight.main} />
          <TrackLabel icon={Music} label="Audio" height={rowHeight.audio} layers={lanes.audio.count} />
        </div>
        <div ref={scroller} className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden" style={{ minHeight: tracksHeight + 12 }}>
          <div ref={content} className="relative" style={{ width, height: tracksHeight }}>
            <div
              data-ruler
              className="relative cursor-ew-resize border-b border-line bg-panel-2"
              style={{ height: H.ruler }}
              onPointerDown={onRulerDown}
            >
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 h-full border-l border-line-strong" style={{ left: t * pps }}>
                  <span className="absolute top-1 left-1 font-mono text-[10px] text-faint">{formatTime(t, step < 1)}</span>
                </div>
              ))}
            </div>

            {itemTrack(
              'text',
              doc.texts,
              '',
              undefined,
              // The subtitles' row: the automatic subtitles, and any text dragged down to share the line.
              <div data-track="subs" className="absolute inset-x-0" style={{ top: rowY('text', 0), height: H.text }}>
                {doc.subtitles.enabled ? (
                  pages.map((p) => (
                    <SubBlock
                      key={p.index}
                      page={p}
                      times={subResize?.times.get(p.index)}
                      pps={pps}
                      selected={selectedKeys.has(`subtitle:${p.index}`)}
                      onDown={onSubDown}
                    />
                  ))
                ) : (
                  <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[11px] text-faint">
                    Pulsa G para poner subtítulos automáticos · los textos se añaden desde la pestaña Texto
                  </span>
                )}
              </div>,
            )}

            {itemTrack('broll', doc.broll, 'Arrastra aquí vídeos o fotos para superponerlos', dropHandlers('broll'))}

            <div
              data-track="main"
              className={clsx('relative border-b border-line', dropTrack === 'main' && 'bg-accent/10')}
              style={{ height: H.main }}
              onPointerDown={onEmptyDown}
              {...dropHandlers('main')}
            >
              {segs.map((seg) => {
                const m = media[seg.mediaId];
                const selected = selectedKeys.has(`segment:${seg.clipId}:${seg.rangeIndex}`);
                let left = seg.tlStart * pps;
                let w = (seg.tlEnd - seg.tlStart) * pps;
                let from = seg.srcStart;
                let to = seg.srcEnd;
                const active = drag && 'seg' in drag && drag.seg.clipId === seg.clipId && drag.seg.rangeIndex === seg.rangeIndex ? drag : null;
                if (active?.kind === 'seg-trim') {
                  // Source seconds added or removed, and the pixels they take at the clip's speed.
                  const dt = (active.dx / pps) * seg.rate;
                  if (active.edge === 'start') {
                    const d = clamp(dt, -seg.srcStart, seg.srcEnd - seg.srcStart - FRAME);
                    left += (d / seg.rate) * pps;
                    w -= (d / seg.rate) * pps;
                    from += d;
                  } else {
                    const max = m?.kind === 'image' ? 3600 : (m?.duration ?? seg.srcEnd);
                    const d = clamp(dt, -(seg.srcEnd - seg.srcStart - FRAME), max - seg.srcEnd);
                    w += (d / seg.rate) * pps;
                    to += d;
                  }
                }
                const hue = mediaHue(seg.mediaId);
                const thumb = m && mediaUrl.thumb(m);
                return (
                  <div
                    key={`${seg.clipId}-${seg.rangeIndex}`}
                    onPointerDown={(e) => onSegDown(e, seg)}
                    onPointerMove={(e) => {
                      if (!dragRef.current)
                        (e.currentTarget as HTMLElement).style.cursor = edgeOf(e, e.currentTarget as HTMLElement) ? TRIM_CURSOR : 'grab';
                    }}
                    className={clsx(
                      'absolute top-1.5 bottom-1.5 overflow-hidden rounded-md border',
                      selected ? 'z-10 border-accent ring-1 ring-accent' : 'border-black/40',
                      active?.kind === 'seg-move' && active.moved && 'opacity-40',
                    )}
                    style={{ left, width: Math.max(2, w - 1), background: `hsl(${hue} 38% 24%)` }}
                    title={m?.name}
                  >
                    {/* The frames of the clip all along it; a photo is simply repeated. */}
                    {m?.filmstrip ? (
                      <FilmstripTiles
                        media={m}
                        from={from}
                        to={to}
                        width={Math.max(2, w - 1)}
                        height={H.main - 14}
                        viewFrom={Math.floor((view.left - left - 400) / 200) * 200}
                        viewTo={Math.ceil((view.left + view.width - left + 400) / 200) * 200}
                      />
                    ) : (
                      thumb && (
                        <div
                          className="pointer-events-none absolute inset-0"
                          style={{
                            backgroundImage: `url(${thumb})`,
                            backgroundSize: 'auto 100%',
                            backgroundRepeat: m?.kind === 'image' ? 'repeat-x' : 'no-repeat',
                          }}
                        />
                      )
                    )}
                    {/* The sound, on a dark band under the frames. */}
                    {m?.hasAudio && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[16px] bg-black/60" />}
                    <Waveform
                      env={envelopes[seg.mediaId]}
                      from={from}
                      to={to}
                      width={Math.max(2, w - 1)}
                      height={16}
                      color="rgb(255 255 255 / 0.75)"
                    />
                    {w > 110 && (
                      <span className="pointer-events-none absolute top-0.5 left-1 max-w-[70%] truncate rounded bg-black/55 px-1 text-[10px] font-medium text-white/90">
                        {m?.name}
                      </span>
                    )}
                    {seg.speed !== 1 && w > 34 && (
                      <span className="pointer-events-none absolute right-1 bottom-0.5 rounded bg-black/70 px-1 text-[9px] font-semibold text-accent">
                        {Math.round(seg.speed * 100) / 100}×
                      </span>
                    )}
                    {seg.rangeIndex > 0 && <div className="pointer-events-none absolute inset-y-0 left-0 w-[2px] bg-danger/80" />}
                    {selected && w > 20 && <Grips />}
                  </div>
                );
              })}
              {drag?.kind === 'seg-move' && drag.moved && (
                <>
                  <div
                    className="pointer-events-none absolute top-1.5 bottom-1.5 z-20 rounded-md border-2 border-accent bg-accent/20"
                    style={{ left: drag.seg.tlStart * pps + drag.dx, width: (drag.seg.tlEnd - drag.seg.tlStart) * pps }}
                  />
                  {moveMarker !== null && (
                    <div
                      className="pointer-events-none absolute top-0 bottom-0 z-30 w-[3px] -translate-x-1/2 bg-accent"
                      style={{ left: moveMarker * pps }}
                    />
                  )}
                </>
              )}
              {!segs.length && (
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[11px] text-faint">
                  Arrastra aquí vídeos o fotos, o pulsa + en el panel
                </span>
              )}
            </div>

            {itemTrack('audio', doc.audio, 'Arrastra aquí música, o graba tu voz en la pestaña Audio', dropHandlers('audio'))}

            {drag?.kind === 'marquee' && drag.moved && (
              <div
                data-marquee
                className="pointer-events-none absolute z-30 rounded-sm border border-accent bg-accent/10"
                style={{
                  left: Math.min(drag.x0, drag.x1),
                  top: Math.min(drag.y0, drag.y1),
                  width: Math.abs(drag.x1 - drag.x0),
                  height: Math.abs(drag.y1 - drag.y0),
                }}
              />
            )}
            <Playhead pps={pps} scroller={scroller} />
          </div>
        </div>
      </div>
    </section>
  );
}

const ITEM_STYLE: Record<ItemKind, string> = {
  // Texts and subtitles are flat orange with white letters, as in CapCut.
  text: 'bg-[#B8501F]',
  broll: 'bg-track-broll/60',
  audio: 'bg-track-audio/45',
};

/**
 * The frames of a video drawn along a clip. Every tile shows the frame of
 * the moment it covers; only the tiles near the visible part of the timeline
 * are created, so a long clip zoomed in stays light.
 */
const FilmstripTiles = memo(function FilmstripTiles({
  media,
  from,
  to,
  width,
  height,
  viewFrom,
  viewTo,
}: {
  media: MediaInfo;
  /** Source seconds shown by the clip. */
  from: number;
  to: number;
  width: number;
  height: number;
  /** Visible range, in pixels from the left edge of the clip. */
  viewFrom: number;
  viewTo: number;
}) {
  const strip = media.filmstrip;
  const url = mediaUrl.filmstrip(media);
  if (!strip || !url) return null;
  const tile = Math.max(8, Math.round((height * strip.tileW) / strip.tileH));
  const rows = filmstripRows(strip);
  const first = Math.max(0, Math.floor(viewFrom / tile));
  const last = Math.min(Math.ceil(width / tile), Math.ceil(viewTo / tile));
  const tiles = [];
  for (let i = first; i < last; i++) {
    const t = from + Math.min(1, ((i + 0.5) * tile) / width) * (to - from);
    const frame = frameAt(strip, t);
    tiles.push(
      <div
        key={i}
        className="absolute top-0"
        style={{
          left: i * tile,
          width: tile,
          height,
          backgroundImage: `url(${url})`,
          backgroundSize: `${strip.cols * tile}px ${rows * height}px`,
          backgroundPosition: `-${(frame % strip.cols) * tile}px -${Math.floor(frame / strip.cols) * height}px`,
        }}
      />,
    );
  }
  return (
    <div data-filmstrip className="pointer-events-none absolute inset-0 overflow-hidden">
      {tiles}
    </div>
  );
});

function ItemBlock({
  item,
  track,
  media,
  env,
  pps,
  drag,
  top,
  selected,
  onDown,
}: {
  item: Item;
  track: ItemKind;
  media?: MediaInfo;
  env?: Envelope;
  pps: number;
  drag: Drag | null;
  /** Top of its row inside the track. */
  top: number;
  selected: boolean;
  onDown: (e: React.PointerEvent, track: ItemKind, item: Item) => void;
}) {
  let { start, duration } = item;
  let srcIn = 'srcIn' in item ? item.srcIn : 0;
  if (drag?.kind === 'group-move' && drag.moved && selected) start = Math.max(0, start + drag.dt);
  if (drag && 'id' in drag && drag.id === item.id) {
    if (drag.kind === 'item-move' && drag.moved) start = drag.start;
    if (drag.kind === 'item-trim') {
      const t = trimItem(item, media, drag.edge, drag.dx / pps);
      start = t.start ?? start;
      duration = t.duration ?? duration;
      srcIn = t.srcIn ?? srcIn;
    }
  }
  const w = Math.max(4, duration * pps);
  const thumb = media && mediaUrl.thumb(media);
  const label = 'text' in item ? item.text.replace(/\s+/g, ' ') : (media?.name ?? 'Recurso no encontrado');
  return (
    <div
      data-item={item.id}
      onPointerDown={(e) => onDown(e, track, item)}
      onPointerMove={(e) => {
        e.currentTarget.style.cursor = edgeAt(e.clientX, e.currentTarget.getBoundingClientRect()) ? TRIM_CURSOR : 'grab';
      }}
      className={clsx(
        'absolute overflow-hidden rounded-md border',
        ITEM_STYLE[track],
        selected ? (track === 'text' ? 'z-10 border-white ring-1 ring-white' : 'z-10 border-accent ring-1 ring-accent') : 'border-black/40',
      )}
      style={{ left: start * pps, width: w, top: top + 4, height: H[track] - 8 }}
      title={label}
    >
      {track === 'broll' && thumb && (
        <div
          className="pointer-events-none absolute inset-0 opacity-45"
          style={{ backgroundImage: `url(${thumb})`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' }}
        />
      )}
      {track === 'audio' && <Waveform env={env} from={srcIn} to={srcIn + duration} width={w} height={26} color="rgb(255 210 120 / 0.45)" />}
      <span className="pointer-events-none absolute top-0.5 left-1.5 truncate pr-2 text-[10px] font-medium whitespace-nowrap text-white/90">
        {label}
        {'volume' in item && ` · ${Math.round(item.volume * 100)}%`}
      </span>
      {selected && w > 20 && <Grips color={track === 'text' ? 'bg-white' : 'bg-accent'} />}
    </div>
  );
}

/** The grips on both edges of a selected element, where it is stretched. */
function Grips({ color = 'bg-accent' }: { color?: string }) {
  return (
    <>
      <span className={clsx('pointer-events-none absolute inset-y-0 left-0 w-[4px]', color)} />
      <span className={clsx('pointer-events-none absolute inset-y-0 right-0 w-[4px]', color)} />
    </>
  );
}

function SubBlock({
  page,
  times,
  pps,
  selected,
  onDown,
}: {
  page: SubPage;
  /** Its times while one of its edges (or the neighbour's) is being dragged. */
  times?: { start: number; end: number };
  pps: number;
  selected: boolean;
  onDown: (e: React.PointerEvent, page: SubPage) => void;
}) {
  const { start, end } = times ?? page;
  // One pixel short of where the next block starts, so two blocks are never drawn over each other.
  const w = Math.max(1, (end - start) * pps - 1);
  return (
    <div
      data-sub={page.index}
      onPointerDown={(e) => onDown(e, page)}
      onPointerMove={(e) => {
        e.currentTarget.style.cursor = edgeAt(e.clientX, e.currentTarget.getBoundingClientRect()) ? TRIM_CURSOR : 'pointer';
      }}
      className={clsx(
        'absolute top-1 bottom-1 overflow-hidden rounded border px-1 text-[10px] leading-[18px] font-semibold whitespace-nowrap',
        // Flat orange with white letters, as in CapCut.
        selected ? 'z-10 border-white bg-[#F07A3A] text-white ring-1 ring-white' : 'border-black/30 bg-[#E0662D] text-white hover:bg-[#EA7035]',
        w < 8 && 'px-0',
      )}
      style={{ left: start * pps, width: w }}
      title={page.words.map((w) => w.text).join(' ')}
    >
      {page.words.map((w) => w.text).join(' ')}
      {selected && w > 20 && <Grips color="bg-white" />}
    </div>
  );
}
