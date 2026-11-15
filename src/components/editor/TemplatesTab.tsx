'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TextItem } from '@/lib/shared/types';
import { DEFAULT_TEXT } from '@/lib/shared/types';
import { TEXT_PRESETS, type TextPreset } from '@/lib/shared/text-presets';
import { textPose } from '@/lib/shared/text-anim';
import { selRefs, useEditor } from '@/lib/client/store';
import { addTextPreset, applyTextPreset, pickItems } from '@/lib/client/actions';
import { loadTextFonts, renderText } from '@/lib/client/text-render';
import { Segmented } from '@/components/ui';

/** Room for the drawing inside a tile, in CSS pixels. */
const BOX = { width: 132, height: 70 };
/** The canvas is drawn at this fraction of the frame resolution and then fitted with CSS. */
const DRAW_RATIO = 0.3;
const LOOP_SECONDS = 2;

/** The preset drawn exactly as the video will show it; hovering plays its entrance and exit. */
function PresetThumb({ preset, playing }: { preset: TextPreset; playing: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const item = useMemo<TextItem>(
    () => ({ ...DEFAULT_TEXT, ...preset.style, id: preset.id, text: preset.sample, start: 0, duration: LOOP_SECONDS }),
    [preset],
  );
  const fit = size.width ? Math.min(BOX.width / size.width, BOX.height / size.height) : 0;

  useEffect(() => {
    let alive = true;
    const draw = () => {
      if (alive && canvas.current) setSize(renderText(canvas.current, item, DRAW_RATIO));
    };
    draw();
    void loadTextFonts([item]).then(draw); // redraw once the font is ready
    return () => {
      alive = false;
    };
  }, [item]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    if (!playing || !fit) {
      el.style.opacity = '';
      el.style.transform = '';
      return;
    }
    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const t = ((now - started) / 1000) % (LOOP_SECONDS + 0.3);
      const pose = textPose(item, Math.min(t, LOOP_SECONDS), LOOP_SECONDS);
      el.style.opacity = t > LOOP_SECONDS ? '0' : String(pose.opacity);
      el.style.transform = `translate(${pose.dx * fit}px, ${pose.dy * fit}px) scale(${pose.scale})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, fit, item]);

  return (
    <span className="flex h-[86px] items-center justify-center overflow-hidden rounded-md bg-[#1c1c1c]">
      <canvas ref={canvas} style={{ width: size.width * fit, height: size.height * fit }} />
    </span>
  );
}

function PresetTile({ preset, onPick }: { preset: TextPreset; onPick: (p: TextPreset) => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      data-preset={preset.id}
      onClick={() => onPick(preset)}
      onMouseUp={(e) => e.currentTarget.blur()}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      className="flex min-w-0 flex-col gap-1 rounded-lg border border-transparent p-1 text-left hover:border-accent"
      title={`${preset.name}: pasa el ratón para ver la animación`}
    >
      <PresetThumb preset={preset} playing={hover} />
      <span className="truncate px-0.5 text-[11px] text-muted">{preset.name}</span>
    </button>
  );
}

/** Ready-made animated texts. A click adds one at the playhead (or restyles the selected text). */
export function TemplatesTab() {
  const doc = useEditor((s) => s.doc)!;
  const selection = useEditor((s) => s.selection);
  const selected = pickItems(doc, selRefs(selection)).filter((x) => x.kind === 'text').length;
  const [mode, setMode] = useState<'add' | 'apply'>('add');
  const applying = mode === 'apply' && selected > 0;
  return (
    <div className="flex flex-col gap-3 p-3">
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted">Al pulsar una plantilla</p>
        <Segmented
          value={applying ? 'apply' : 'add'}
          onChange={setMode}
          options={[
            { value: 'add', label: 'Añadir un texto nuevo' },
            { value: 'apply', label: selected > 1 ? `Cambiar los ${selected} seleccionados` : 'Cambiar el seleccionado' },
          ]}
        />
        {mode === 'apply' && !selected && (
          <p className="mt-1.5 text-[11px] text-faint">Selecciona antes un texto en la línea de tiempo o en el vídeo.</p>
        )}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-1.5">
        {TEXT_PRESETS.map((p) => (
          <PresetTile key={p.id} preset={p} onPick={applying ? applyTextPreset : addTextPreset} />
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-faint">
        Pasa el ratón por una plantilla para ver cómo entra y sale. Después de añadirla cambia su texto, colores, fondo y animación en el panel de la
        derecha (pestañas Texto y Animación).
      </p>
    </div>
  );
}
