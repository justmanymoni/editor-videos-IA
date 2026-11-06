'use client';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Captions, Film, Image as ImageIcon, Maximize2, Music, Scissors, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import type { AudioItem, BrollItem, Envelope, MediaInfo } from '@/lib/shared/types';
import { FRAME, clamp } from '@/lib/shared/ranges';
import { sequenceDuration, type Segment } from '@/lib/shared/timeline';
import type { SubPage } from '@/lib/shared/subtitles';
import { mediaUrl } from '@/lib/client/api';
import { useEditor, type Selection } from '@/lib/client/store';
import { useSegments, useSubtitlePages } from '@/lib/client/derived';
import { player, usePlayback } from '@/lib/client/player';
import { formatTime, mediaHue } from '@/lib/client/format';
import { addAudio, addBroll, deleteSelection, moveSegment, splitAtPlayhead, trimSegment, updateItem } from '@/lib/client/actions';
import { IconButton, Slider } from '@/components/ui';
import { MEDIA_DRAG_TYPE } from './MediaPanel';

const H = { ruler: 24, main: 64, broll: 46, audio: 40, subs: 30 };
const EDGE = 7;
const MIN_PPS = 4;
const MAX_PPS = 400;

type Drag =
  | { kind: 'scrub' }
  | { kind: 'seg-move'; seg: Segment; x0: number; dx: number; moved: boolean; t0: number }
  | { kind: 'seg-trim'; seg: Segment; edge: 'start' | 'end'; x0: number; dx: number }
  | { kind: 'item-move'; track: 'broll' | 'audio'; id: string; x0: number; dx: number; moved: boolean; start: number }
  | { kind: 'item-trim'; track: 'broll' | 'audio'; id: string; edge: 'start' | 'end'; x0: number; dx: number };

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

function TrackLabel({ icon: Icon, label, height }: { icon: typeof Film; label: string; height: number }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-line px-3 text-[11px] font-medium text-muted" style={{ height }}>
      <Icon size={12} /> {label}
    </div>
  );
}

function Inspector({ selection }: { selection: Selection }) {
  const doc = useEditor((s) => s.doc)!;
  const media = useEditor((s) => s.media);
  if (selection?.kind === 'audio') {
    const a = doc.audio.find((x) => x.id === selection.id);
    if (!a) return null;
    const set = (patch: Partial<AudioItem>, key: string) => updateItem('audio', a.id, patch, `${key}:${a.id}`);
    return (
      <div className="flex items-center gap-3 text-[11px] text-muted">
        <span className="max-w-40 truncate text-fg">{media[a.mediaId]?.name}</span>
        <label className="flex items-center gap-1.5">
          Volumen
          <div className="w-20">
            <Slider value={a.volume} min={0} max={2} step={0.05} onChange={(v) => set({ volume: v }, 'vol')} />
          </div>
          <span className="w-8 tabular-nums">{Math.round(a.volume * 100)}%</span>
        </label>
        <label className="flex items-center gap-1.5">
          Entrada
          <input
            type="number"
            min={0}
            max={10}
            step={0.5}
            value={a.fadeIn}
            onChange={(e) => set({ fadeIn: Number(e.target.value) }, 'fi')}
            className="h-6 w-12 rounded border border-line-strong bg-panel-2 px-1 text-fg"
          />
          s
        </label>
        <label className="flex items-center gap-1.5">
          Salida
          <input
            type="number"
            min={0}
            max={10}
            step={0.5}
            value={a.fadeOut}
            onChange={(e) => set({ fadeOut: Number(e.target.value) }, 'fo')}
            className="h-6 w-12 rounded border border-line-strong bg-panel-2 px-1 text-fg"
          />
          s
        </label>
      </div>
    );
  }
  if (selection?.kind === 'broll') {
    const b = doc.broll.find((x) => x.id === selection.id);
    if (!b) return null;
    return (
      <span className="text-[11px] text-muted">
        <span className="text-fg">{media[b.mediaId]?.name}</span> · {formatTime(b.start)} → {formatTime(b.start + b.duration)}
      </span>
    );
  }
  if (selection?.kind === 'segment') {
    const c = doc.clips.find((x) => x.id === selection.clipId);
    return c ? (
      <span className="text-[11px] text-muted">
        Fragmento de <span className="text-fg">{media[c.mediaId]?.name}</span> · Supr lo corta, arrástralo para moverlo
      </span>
    ) : null;
  }
  if (selection?.kind === 'subtitle') return <span className="text-[11px] text-muted">Subtítulo · S divide en el cursor · Supr lo oculta</span>;
  return <span className="text-[11px] text-faint">Arrastra los bordes para recortar · arrastra un bloque para moverlo · Ctrl + rueda para zoom</span>;
}

export function Timeline() {
  const doc = useEditor((s) => s.doc)!;
  const media = useEditor((s) => s.media);
  const envelopes = useEditor((s) => s.envelopes);
  const selection = useEditor((s) => s.selection);
  const segs = useSegments();
  const pages = useSubtitlePages();
  const duration = sequenceDuration(segs);
  const scroller = useRef<HTMLDivElement>(null);
  const [pps, setPps] = useState(60);
  const [drag, setDragState] = useState<Drag | null>(null);
  const [dropTrack, setDropTrack] = useState<'broll' | 'audio' | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const fitted = useRef(false);
  const live = useRef({ pps, segs, doc, media, duration });
  live.current = { pps, segs, doc, media, duration };

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

  const snapPoints = (exclude?: string) => {
    const { segs: s, doc: d } = live.current;
    const pts = [0, usePlayback.getState().time, sequenceDuration(s)];
    for (const seg of s) pts.push(seg.tlStart);
    for (const b of [...d.broll, ...d.audio]) if (b.id !== exclude) pts.push(b.start, b.start + b.duration);
    return pts;
  };
  const snap = (t: number, pts: number[]) => {
    let best = t;
    let dist = 8 / live.current.pps;
    for (const p of pts) if (Math.abs(p - t) < dist) [best, dist] = [p, Math.abs(p - t)];
    return best;
  };

  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };

  const finish = useCallback(() => {
    const d = dragRef.current;
    const { pps: p, doc: dc, media: md } = live.current;
    setDrag(null);
    if (!d) return;
    const dt = ('dx' in d ? d.dx : 0) / p;
    if (d.kind === 'seg-trim' && Math.abs(d.dx) > 1) {
      trimSegment(d.seg.clipId, d.seg.rangeIndex, d.edge, (d.edge === 'start' ? d.seg.srcStart : d.seg.srcEnd) + dt);
    } else if (d.kind === 'seg-move') {
      if (d.moved) moveSegment(d.seg.clipId, d.seg.rangeIndex, (d.seg.tlStart + d.seg.tlEnd) / 2 + dt);
      else player.seek(d.t0);
    } else if (d.kind === 'item-move' && d.moved) {
      updateItem(d.track, d.id, { start: Math.max(0, d.start) });
    } else if (d.kind === 'item-trim' && Math.abs(d.dx) > 1) {
      const item = (dc[d.track] as (BrollItem | AudioItem)[]).find((x) => x.id === d.id);
      const m = item && md[item.mediaId];
      if (item && m) updateItem(d.track, d.id, trimItem(item, m, d.edge, dt));
    }
  }, []);

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.kind === 'scrub') return player.seek(timeAt(e.clientX));
      const dx = e.clientX - d.x0;
      if (d.kind === 'item-move') {
        const item = (live.current.doc[d.track] as (BrollItem | AudioItem)[]).find((x) => x.id === d.id);
        if (!item) return;
        const pts = snapPoints(d.id);
        let start = Math.max(0, item.start + dx / live.current.pps);
        const snappedStart = snap(start, pts);
        const snappedEnd = snap(start + item.duration, pts) - item.duration;
        start = snappedStart !== start ? snappedStart : snappedEnd;
        setDrag({ ...d, dx, moved: d.moved || Math.abs(dx) > 3, start: Math.max(0, start) });
      } else if (d.kind === 'seg-move') setDrag({ ...d, dx, moved: d.moved || Math.abs(dx) > 4 });
      else setDrag({ ...d, dx });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null, finish]);

  const select = (sel: Selection) => useEditor.getState().setSelection(sel);
  const edgeOf = (e: React.PointerEvent, el: HTMLElement): 'start' | 'end' | null => {
    const r = el.getBoundingClientRect();
    if (r.width < EDGE * 3) return null;
    if (e.clientX - r.left < EDGE) return 'start';
    if (r.right - e.clientX < EDGE) return 'end';
    return null;
  };

  const onSegDown = (e: React.PointerEvent, seg: Segment) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    select({ kind: 'segment', clipId: seg.clipId, rangeIndex: seg.rangeIndex });
    const edge = edgeOf(e, e.currentTarget as HTMLElement);
    if (edge) setDrag({ kind: 'seg-trim', seg, edge, x0: e.clientX, dx: 0 });
    else setDrag({ kind: 'seg-move', seg, x0: e.clientX, dx: 0, moved: false, t0: timeAt(e.clientX) });
  };

  const onItemDown = (e: React.PointerEvent, track: 'broll' | 'audio', item: BrollItem | AudioItem) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    select({ kind: track, id: item.id });
    const edge = edgeOf(e, e.currentTarget as HTMLElement);
    if (edge) setDrag({ kind: 'item-trim', track, id: item.id, edge, x0: e.clientX, dx: 0 });
    else setDrag({ kind: 'item-move', track, id: item.id, x0: e.clientX, dx: 0, moved: false, start: item.start });
  };

  const onEmptyDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    select(null);
    player.seek(timeAt(e.clientX));
    setDrag({ kind: 'scrub' });
  };

  const dropHandlers = (track: 'broll' | 'audio') => ({
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
      if (track === 'audio' && m.kind === 'audio') addAudio(m, t);
      else if (track === 'broll' && m.kind !== 'audio') addBroll(m, t);
      else useEditor.getState().toast(track === 'audio' ? 'En la pista de audio solo va música o sonido' : 'Arrastra la música a la pista de audio');
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

  const moveMarker =
    drag?.kind === 'seg-move' && drag.moved ? nearest(clipBoundaries, (drag.seg.tlStart + drag.seg.tlEnd) / 2 + drag.dx / pps) : null;

  return (
    <section
      data-timeline
      className="flex shrink-0 flex-col border-t border-line bg-panel select-none"
      style={{ height: 40 + H.ruler + H.main + H.broll + H.audio + H.subs + 14 }}
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-2">
        <IconButton label="Dividir en el cursor (S)" onClick={splitAtPlayhead}>
          <Scissors size={15} />
        </IconButton>
        <IconButton label="Borrar selección (Supr)" onClick={deleteSelection} disabled={!selection}>
          <Trash2 size={15} />
        </IconButton>
        <div className="mx-2 h-5 w-px bg-line" />
        <div className="min-w-0 flex-1 truncate">
          <Inspector selection={selection} />
        </div>
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
      <div className="flex min-h-0 flex-1">
        <div className="w-28 shrink-0 border-r border-line">
          <div style={{ height: H.ruler }} className="border-b border-line" />
          <TrackLabel icon={Film} label="Vídeo" height={H.main} />
          <TrackLabel icon={ImageIcon} label="B-roll" height={H.broll} />
          <TrackLabel icon={Music} label="Audio" height={H.audio} />
          <TrackLabel icon={Captions} label="Subtítulos" height={H.subs} />
        </div>
        <div ref={scroller} className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="relative" style={{ width, height: H.ruler + H.main + H.broll + H.audio + H.subs }}>
            {/* Ruler */}
            <div className="relative cursor-ew-resize border-b border-line bg-panel-2" style={{ height: H.ruler }} onPointerDown={onEmptyDown}>
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 h-full border-l border-line-strong" style={{ left: t * pps }}>
                  <span className="absolute top-1 left-1 font-mono text-[10px] text-faint">{formatTime(t, step < 1)}</span>
                </div>
              ))}
            </div>

            {/* Main video */}
            <div data-track="main" className="relative border-b border-line" style={{ height: H.main }} onPointerDown={onEmptyDown}>
              {segs.map((seg) => {
                const m = media[seg.mediaId];
                const selected = selection?.kind === 'segment' && selection.clipId === seg.clipId && selection.rangeIndex === seg.rangeIndex;
                let left = seg.tlStart * pps;
                let w = (seg.tlEnd - seg.tlStart) * pps;
                let from = seg.srcStart;
                let to = seg.srcEnd;
                const active = drag && 'seg' in drag && drag.seg.clipId === seg.clipId && drag.seg.rangeIndex === seg.rangeIndex ? drag : null;
                if (active?.kind === 'seg-trim') {
                  const dt = active.dx / pps;
                  if (active.edge === 'start') {
                    const d = clamp(dt, -seg.srcStart, seg.srcEnd - seg.srcStart - FRAME);
                    left += d * pps;
                    w -= d * pps;
                    from += d;
                  } else {
                    const d = clamp(dt, -(seg.srcEnd - seg.srcStart - FRAME), (m?.duration ?? seg.srcEnd) - seg.srcEnd);
                    w += d * pps;
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
                        (e.currentTarget as HTMLElement).style.cursor = edgeOf(e, e.currentTarget as HTMLElement) ? 'ew-resize' : 'grab';
                    }}
                    className={clsx(
                      'absolute top-1.5 bottom-1.5 overflow-hidden rounded-md border',
                      selected ? 'z-10 border-accent ring-1 ring-accent' : 'border-black/40',
                      active?.kind === 'seg-move' && active.moved && 'opacity-40',
                    )}
                    style={{ left, width: Math.max(2, w - 1), background: `hsl(${hue} 38% 24%)` }}
                    title={m?.name}
                  >
                    {thumb && w > 48 && (
                      <img
                        src={thumb}
                        alt=""
                        draggable={false}
                        className="pointer-events-none absolute top-0 left-0 h-full w-9 object-cover opacity-80"
                      />
                    )}
                    <Waveform
                      env={envelopes[seg.mediaId]}
                      from={from}
                      to={to}
                      width={Math.max(2, w - 1)}
                      height={30}
                      color={`hsl(${hue} 60% 62% / 0.55)`}
                    />
                    {w > 60 && (
                      <span className="pointer-events-none absolute top-1 left-10 truncate pr-2 text-[10px] font-medium text-white/85">
                        {m?.name}
                      </span>
                    )}
                    {seg.rangeIndex > 0 && <div className="pointer-events-none absolute inset-y-0 left-0 w-[2px] bg-danger/80" />}
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
                <span className="absolute top-1/2 left-3 -translate-y-1/2 text-[11px] text-faint">Los clips aparecen aquí al subirlos</span>
              )}
            </div>

            {/* B-roll */}
            <div
              data-track="broll"
              className={clsx('relative border-b border-line', dropTrack === 'broll' && 'bg-accent/10')}
              style={{ height: H.broll }}
              onPointerDown={onEmptyDown}
              {...dropHandlers('broll')}
            >
              {doc.broll.map((b) => (
                <ItemBlock
                  key={b.id}
                  item={b}
                  track="broll"
                  media={media[b.mediaId]}
                  pps={pps}
                  drag={drag}
                  selected={selection?.kind === 'broll' && selection.id === b.id}
                  onDown={onItemDown}
                />
              ))}
              {!doc.broll.length && (
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[11px] text-faint">
                  Arrastra aquí clips o imágenes desde la pestaña B-roll
                </span>
              )}
            </div>

            {/* Audio */}
            <div
              data-track="audio"
              className={clsx('relative border-b border-line', dropTrack === 'audio' && 'bg-accent/10')}
              style={{ height: H.audio }}
              onPointerDown={onEmptyDown}
              {...dropHandlers('audio')}
            >
              {doc.audio.map((a) => (
                <ItemBlock
                  key={a.id}
                  item={a}
                  track="audio"
                  media={media[a.mediaId]}
                  env={envelopes[a.mediaId]}
                  pps={pps}
                  drag={drag}
                  selected={selection?.kind === 'audio' && selection.id === a.id}
                  onDown={onItemDown}
                />
              ))}
              {!doc.audio.length && (
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[11px] text-faint">
                  Arrastra aquí música desde la pestaña Música
                </span>
              )}
            </div>

            {/* Subtitles */}
            <div data-track="subs" className="relative" style={{ height: H.subs }} onPointerDown={onEmptyDown}>
              {doc.subtitles.enabled &&
                pages.map((p) => (
                  <SubBlock key={p.index} page={p} pps={pps} selected={selection?.kind === 'subtitle' && selection.page === p.index} />
                ))}
            </div>

            <Playhead pps={pps} scroller={scroller} />
          </div>
        </div>
      </div>
    </section>
  );
}

function nearest(points: number[], t: number) {
  return points.reduce((best, p) => (Math.abs(p - t) < Math.abs(best - t) ? p : best), points[0] ?? 0);
}

function trimItem(item: BrollItem | AudioItem, m: MediaInfo, edge: 'start' | 'end', dt: number): Partial<BrollItem & AudioItem> {
  const still = m.kind === 'image';
  const minDur = 0.2;
  if (edge === 'start') {
    const d = clamp(dt, -Math.min(item.start, still ? Infinity : item.srcIn), item.duration - minDur);
    return { start: item.start + d, duration: item.duration - d, srcIn: still ? 0 : item.srcIn + d };
  }
  const maxExtra = still ? Infinity : m.duration - (item.srcIn + item.duration);
  const d = clamp(dt, -(item.duration - minDur), maxExtra);
  return { duration: item.duration + d };
}

function ItemBlock({
  item,
  track,
  media,
  env,
  pps,
  drag,
  selected,
  onDown,
}: {
  item: BrollItem | AudioItem;
  track: 'broll' | 'audio';
  media?: MediaInfo;
  env?: Envelope;
  pps: number;
  drag: Drag | null;
  selected: boolean;
  onDown: (e: React.PointerEvent, track: 'broll' | 'audio', item: BrollItem | AudioItem) => void;
}) {
  let { start, duration, srcIn } = item;
  if (drag && 'id' in drag && drag.id === item.id) {
    if (drag.kind === 'item-move' && drag.moved) start = drag.start;
    if (drag.kind === 'item-trim' && media) {
      const t = trimItem(item, media, drag.edge, drag.dx / pps);
      start = t.start ?? start;
      duration = t.duration ?? duration;
      srcIn = t.srcIn ?? srcIn;
    }
  }
  const w = Math.max(4, duration * pps);
  const thumb = media && mediaUrl.thumb(media);
  return (
    <div
      onPointerDown={(e) => onDown(e, track, item)}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.cursor = r.width > EDGE * 3 && (e.clientX - r.left < EDGE || r.right - e.clientX < EDGE) ? 'ew-resize' : 'grab';
      }}
      className={clsx(
        'absolute top-1 bottom-1 overflow-hidden rounded-md border',
        track === 'broll' ? 'bg-track-broll/60' : 'bg-track-audio/45',
        selected ? 'z-10 border-accent ring-1 ring-accent' : 'border-black/40',
      )}
      style={{ left: start * pps, width: w }}
      title={media?.name}
    >
      {track === 'broll' && thumb && (
        <div
          className="pointer-events-none absolute inset-0 opacity-45"
          style={{ backgroundImage: `url(${thumb})`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' }}
        />
      )}
      {track === 'audio' && <Waveform env={env} from={srcIn} to={srcIn + duration} width={w} height={26} color="rgb(255 210 120 / 0.45)" />}
      <span className="pointer-events-none absolute top-0.5 left-1.5 truncate pr-2 text-[10px] font-medium text-white/90">
        {media?.name ?? 'Recurso no encontrado'}
        {track === 'audio' && ` · ${Math.round((item as AudioItem).volume * 100)}%`}
      </span>
    </div>
  );
}

function SubBlock({ page, pps, selected }: { page: SubPage; pps: number; selected: boolean }) {
  return (
    <div
      onPointerDown={(e) => {
        e.stopPropagation();
        useEditor.getState().setSelection({ kind: 'subtitle', page: page.index });
        // Seek to the clicked point so S can split the block right there.
        const r = e.currentTarget.getBoundingClientRect();
        player.seek(page.start + ((e.clientX - r.left) / Math.max(1, r.width)) * (page.end - page.start));
      }}
      className={clsx(
        'absolute top-1 bottom-1 cursor-pointer overflow-hidden rounded border px-1 text-[10px] leading-[20px] font-semibold whitespace-nowrap',
        selected ? 'z-10 border-accent bg-accent/30 text-fg' : 'border-accent/25 bg-accent/10 text-accent/90 hover:bg-accent/20',
      )}
      style={{ left: page.start * pps, width: Math.max(3, (page.end - page.start) * pps - 1) }}
      title={page.words.map((w) => w.text).join(' ')}
    >
      {page.words.map((w) => w.text).join(' ')}
    </div>
  );
}
