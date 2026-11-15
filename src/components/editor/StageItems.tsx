'use client';
/**
 * Elements the user places on the frame: manual texts (drawn on canvases)
 * and the box with handles to move, resize and rotate the selected text or
 * overlay. All coordinates are in the 1080x1920 frame; the stage is scaled
 * with CSS, so gestures convert screen pixels with the stage's real size.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCw } from 'lucide-react';
import type { BrollItem, TextItem } from '@/lib/shared/types';
import { OUTPUT_HEIGHT, OUTPUT_WIDTH } from '@/lib/shared/types';
import { clamp } from '@/lib/shared/ranges';
import { overlayRect } from '@/lib/shared/text-curve';
import { useEditor } from '@/lib/client/store';
import { usePlayback } from '@/lib/client/player';
import { updateItem } from '@/lib/client/actions';
import { loadTextFonts, renderText } from '@/lib/client/text-render';

type Target = { kind: 'text'; item: TextItem } | { kind: 'broll'; item: BrollItem };
type Mode = 'move' | 'scale' | 'rotate';
export type Guides = { x: boolean; y: boolean } | null;

/** Starts a move / resize / rotate gesture on a text or overlay. */
export function useStageGestures() {
  const [guides, setGuides] = useState<Guides>(null);

  const begin = useCallback((e: React.PointerEvent, mode: Mode, target: Target) => {
    if (e.button !== 0) return;
    const stageEl = (e.currentTarget as HTMLElement).closest('[data-stage]');
    if (!stageEl) return;
    e.stopPropagation();
    e.preventDefault();
    const { kind, item } = target;
    useEditor.getState().setSelection({ kind, id: item.id });
    const stage = stageEl.getBoundingClientRect();
    const x0 = item.x ?? 0.5;
    const y0 = item.y ?? 0.5;
    const scale0 = item.scale ?? 1;
    const rot0 = kind === 'text' ? target.item.rotation : 0;
    const cx = stage.left + x0 * stage.width;
    const cy = stage.top + y0 * stage.height;
    const dist0 = Math.hypot(e.clientX - cx, e.clientY - cy) || 1;
    const angle0 = Math.atan2(e.clientY - cy, e.clientX - cx);
    const key = `${mode}:${item.id}:${Date.now()}`; // one undo step per gesture

    const move = (ev: PointerEvent) => {
      if (mode === 'move') {
        let x = x0 + (ev.clientX - e.clientX) / stage.width;
        let y = y0 + (ev.clientY - e.clientY) / stage.height;
        // Snap to the centre of the frame, with guide lines.
        const snapX = Math.abs(x - 0.5) * stage.width < 7;
        const snapY = Math.abs(y - 0.5) * stage.height < 7;
        if (snapX) x = 0.5;
        if (snapY) y = 0.5;
        setGuides({ x: snapX, y: snapY });
        updateItem(kind, item.id, { x, y }, key);
      } else if (mode === 'scale') {
        const dist = Math.hypot(ev.clientX - cx, ev.clientY - cy);
        updateItem(kind, item.id, { scale: clamp((scale0 * dist) / dist0, 0.05, 8) }, key);
      } else {
        let deg = rot0 + ((Math.atan2(ev.clientY - cy, ev.clientX - cx) - angle0) * 180) / Math.PI;
        deg = ((((deg + 180) % 360) + 360) % 360) - 180;
        const nearest = Math.round(deg / 45) * 45;
        if (Math.abs(deg - nearest) < 4) deg = nearest;
        updateItem('text', item.id, { rotation: Math.round(deg) }, key);
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      setGuides(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }, []);

  return { begin, guides };
}

type Size = { width: number; height: number };

function TextLayer({ item, onSize, onDown }: { item: TextItem; onSize: (id: string, size: Size) => void; onDown: (e: React.PointerEvent) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    let alive = true;
    const draw = () => {
      if (!alive || !ref.current) return;
      const next = renderText(ref.current, item, 1);
      setSize(next);
      onSize(item.id, next);
    };
    draw();
    void loadTextFonts([item]).then(draw); // redraw once the font is ready
    return () => {
      alive = false;
    };
  }, [item, onSize]);
  return (
    <canvas
      ref={ref}
      data-text={item.id}
      onPointerDown={onDown}
      className="absolute max-w-none cursor-move"
      style={{ left: item.x * OUTPUT_WIDTH - size.width / 2, top: item.y * OUTPUT_HEIGHT - size.height / 2, width: size.width, height: size.height }}
    />
  );
}

/** Texts visible at the current time, plus the selection box of the selected text or overlay. */
export function StageItems({
  stageScale,
  begin,
  guides,
}: {
  stageScale: number;
  begin: ReturnType<typeof useStageGestures>['begin'];
  guides: Guides;
}) {
  const texts = useEditor((s) => s.doc!.texts);
  const broll = useEditor((s) => s.doc!.broll);
  const media = useEditor((s) => s.media);
  const selection = useEditor((s) => s.selection);
  const [sizes, setSizes] = useState<Record<string, Size>>({});
  const onSize = useCallback(
    (id: string, size: Size) =>
      setSizes((prev) => (prev[id]?.width === size.width && prev[id]?.height === size.height ? prev : { ...prev, [id]: size })),
    [],
  );

  // Re-render only when the set of visible texts changes, not on every frame.
  const visibleKey = usePlayback((s) =>
    texts
      .filter((t) => s.time >= t.start - 1e-3 && s.time < t.start + t.duration)
      .map((t) => t.id)
      .join(','),
  );
  const visible = new Set(visibleKey.split(','));

  const selText = selection?.kind === 'text' ? texts.find((t) => t.id === selection.id) : undefined;
  const selOverlay = selection?.kind === 'broll' ? broll.find((b) => b.id === selection.id) : undefined;
  const overlayShown = usePlayback((s) => !!selOverlay && s.time >= selOverlay.start - 1e-3 && s.time < selOverlay.start + selOverlay.duration);

  let box: { left: number; top: number; width: number; height: number; target: Target } | null = null;
  if (selText && visible.has(selText.id) && sizes[selText.id]) {
    const { width, height } = sizes[selText.id];
    box = {
      left: selText.x * OUTPUT_WIDTH - width / 2,
      top: selText.y * OUTPUT_HEIGHT - height / 2,
      width,
      height,
      target: { kind: 'text', item: selText },
    };
  } else if (selOverlay && overlayShown) {
    const m = media[selOverlay.mediaId];
    box = {
      ...overlayRect(m?.width ?? 0, m?.height ?? 0, OUTPUT_WIDTH, OUTPUT_HEIGHT, selOverlay.x, selOverlay.y, selOverlay.scale),
      target: { kind: 'broll', item: selOverlay },
    };
  }

  const px = 1 / Math.max(stageScale, 0.05); // one screen pixel, in frame units
  const handle = 13 * px;
  // Keep the handles reachable when the element is bigger than the frame or partly outside it.
  if (box) {
    const left = clamp(box.left, 0, OUTPUT_WIDTH - 4 * handle);
    const top = clamp(box.top, 0, OUTPUT_HEIGHT - 4 * handle);
    const right = clamp(box.left + box.width, left + 4 * handle, OUTPUT_WIDTH);
    const bottom = clamp(box.top + box.height, top + 4 * handle, OUTPUT_HEIGHT);
    box = { ...box, left, top, width: right - left, height: bottom - top };
  }
  // A handle centred on a corner that lies on the edge of the frame would be clipped: keep it inside.
  const offset = {
    left: box && box.left < handle / 2 ? 0 : -handle / 2,
    top: box && box.top < handle / 2 ? 0 : -handle / 2,
    right: box && box.left + box.width > OUTPUT_WIDTH - handle / 2 ? 0 : -handle / 2,
    bottom: box && box.top + box.height > OUTPUT_HEIGHT - handle / 2 ? 0 : -handle / 2,
  };
  return (
    <>
      {texts
        .filter((t) => visible.has(t.id))
        .map((t) => (
          <TextLayer key={t.id} item={t} onSize={onSize} onDown={(e) => begin(e, 'move', { kind: 'text', item: t })} />
        ))}
      {guides?.x && <div className="pointer-events-none absolute inset-y-0 bg-accent" style={{ left: OUTPUT_WIDTH / 2 - px, width: 2 * px }} />}
      {guides?.y && <div className="pointer-events-none absolute inset-x-0 bg-accent" style={{ top: OUTPUT_HEIGHT / 2 - px, height: 2 * px }} />}
      {box && (
        <div
          data-selection-box
          className="pointer-events-none absolute border-accent"
          style={{ left: box.left, top: box.top, width: box.width, height: box.height, borderWidth: 2 * px, borderStyle: 'solid' }}
        >
          {(
            [
              ['left', 'top', 'nwse-resize'],
              ['right', 'top', 'nesw-resize'],
              ['left', 'bottom', 'nesw-resize'],
              ['right', 'bottom', 'nwse-resize'],
            ] as const
          ).map(([h, v, cursor]) => (
            <div
              key={h + v}
              data-handle="scale"
              onPointerDown={(e) => begin(e, 'scale', box.target)}
              className="pointer-events-auto absolute rounded-sm border-black bg-accent"
              style={{ [h]: offset[h], [v]: offset[v], width: handle, height: handle, cursor, borderWidth: px, borderStyle: 'solid' }}
            />
          ))}
          {box.target.kind === 'text' && (
            <div
              data-handle="rotate"
              onPointerDown={(e) => begin(e, 'rotate', box.target)}
              className="pointer-events-auto absolute flex cursor-grab items-center justify-center rounded-full bg-accent text-black"
              style={{ left: '50%', top: box.top > 40 * px ? -34 * px : 10 * px, width: 22 * px, height: 22 * px, marginLeft: -11 * px }}
              title="Girar"
            >
              <RotateCw size={13 * px} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
