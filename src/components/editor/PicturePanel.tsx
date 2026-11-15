'use client';
/**
 * "Vídeo › Básico", as in CapCut: where the picture goes (Transformación), how
 * it is mixed with what is below (Mezcla) and the improvements applied to it.
 * It works on one or several clips of the main track, or overlays, at once.
 */
import type { ReactNode } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  RotateCcw,
} from 'lucide-react';
import type { BlendMode, MediaInfo, PictureSettings } from '@/lib/shared/types';
import {
  BLEND_MODES,
  MIX_RESET,
  STABILIZE_LEVELS,
  TRANSFORM_RESET,
  alignPicture,
  pictureOf,
  pictureRect,
  positionFromPx,
  positionPx,
  type Align,
} from '@/lib/shared/picture';
import { updateClips, updateItems } from '@/lib/client/actions';
import { CheckSection, MiniToggle, Row, Segmented, SliderRow, Toggle } from '@/components/ui';

/** A block of settings with its title and a button that puts them back as they come. */
function Block({ title, onReset, children }: { title: string; onReset: () => void; children: ReactNode }) {
  return (
    <section data-picture-block={title} className="flex flex-col gap-2 border-b border-line px-3.5 py-3 last:border-0">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-fg">{title}</h3>
        <button
          type="button"
          aria-label={`Restablecer ${title.toLowerCase()}`}
          title={`Restablecer ${title.toLowerCase()}`}
          onClick={onReset}
          onMouseUp={(e) => e.currentTarget.blur()}
          className="rounded p-0.5 text-muted hover:text-fg"
        >
          <RotateCcw size={13} />
        </button>
      </div>
      {children}
    </section>
  );
}

function NumberBox({ label, prefix, value, onChange }: { label: string; prefix: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex h-6 min-w-0 flex-1 items-center gap-1 rounded bg-panel-3 px-1.5 text-[11px] text-fg">
      <span className="text-faint">{prefix}</span>
      <input
        type="number"
        aria-label={label}
        value={value}
        step={1}
        onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange(e.target.valueAsNumber)}
        className="w-full min-w-0 bg-transparent text-right tabular-nums outline-none"
      />
    </label>
  );
}

const Note = ({ children }: { children: ReactNode }) => <p className="text-[11px] leading-relaxed text-faint">{children}</p>;

const ALIGN: [Align, string, typeof AlignStartVertical][] = [
  ['left', 'Alinear a la izquierda', AlignStartVertical],
  ['centerX', 'Centrar a lo ancho', AlignCenterVertical],
  ['right', 'Alinear a la derecha', AlignEndVertical],
  ['top', 'Alinear arriba', AlignStartHorizontal],
  ['centerY', 'Centrar a lo alto', AlignCenterHorizontal],
  ['bottom', 'Alinear abajo', AlignEndHorizontal],
];

export function PicturePanel({
  kind,
  ids,
  value,
  media,
  contain = false,
  slowed = false,
}: {
  kind: 'clip' | 'broll';
  /** Every clip or overlay the changes go to. */
  ids: string[];
  /** The settings shown: those of the first one. */
  value: PictureSettings;
  media?: MediaInfo;
  /** Clips of a project with the blurred background fit inside the frame at 100 %. */
  contain?: boolean;
  /** The clip plays slower than it was shot (what "flujo óptico" is for). */
  slowed?: boolean;
}) {
  const pic = pictureOf(value);
  const set = (patch: PictureSettings, key?: string) => {
    const coalesce = key && `pic:${key}:${ids.length}:${ids[0]}`;
    if (kind === 'clip') updateClips(ids, patch, coalesce);
    else
      updateItems(
        ids.map((id) => ({ kind: 'broll', id, patch })),
        coalesce,
      );
  };
  const video = media?.kind === 'video';
  const rect = pictureRect(media?.width ?? 0, media?.height ?? 0, pic, contain);
  const pos = positionPx(pic);

  return (
    <>
      <Block title="Transformación" onReset={() => set(TRANSFORM_RESET)}>
        {pic.uniform ? (
          <SliderRow
            label="Escala"
            value={pic.scale}
            min={0.1}
            max={5}
            step={0.01}
            scale={100}
            unit="%"
            onChange={(v) => set({ scale: v }, 'scale')}
          />
        ) : (
          <>
            <SliderRow label="Ancho" value={pic.scale} min={0.1} max={5} step={0.01} scale={100} unit="%" onChange={(v) => set({ scale: v }, 'sx')} />
            <SliderRow
              label="Alto"
              value={pic.scaleY}
              min={0.1}
              max={5}
              step={0.01}
              scale={100}
              unit="%"
              onChange={(v) => set({ scaleY: v }, 'sy')}
            />
          </>
        )}
        <Toggle label="Escala uniforme" checked={pic.uniform} onChange={(v) => set({ scaleY: v ? undefined : pic.scale })} />
        <Row label="Posición">
          <NumberBox label="Posición X" prefix="X" value={pos.x} onChange={(v) => set(positionFromPx({ x: v }), 'px')} />
          <NumberBox label="Posición Y" prefix="Y" value={pos.y} onChange={(v) => set(positionFromPx({ y: v }), 'py')} />
        </Row>
        <SliderRow label="Girar" value={pic.rotation} min={-180} max={180} step={1} unit="°" onChange={(v) => set({ rotation: v }, 'rot')} />
        <div className="flex items-center gap-1" role="group" aria-label="Alinear">
          {ALIGN.map(([align, label, Icon], i) => (
            <span key={align} className={i === 3 ? 'ml-2' : undefined}>
              <MiniToggle active={false} label={label} onClick={() => set(alignPicture(rect, pic.rotation, align))}>
                <Icon size={14} />
              </MiniToggle>
            </span>
          ))}
        </div>
      </Block>

      <Block title="Mezcla" onReset={() => set(MIX_RESET)}>
        {kind === 'broll' && (
          <Row label="Modo">
            <select
              aria-label="Modo de mezcla"
              value={pic.blend}
              onChange={(e) => set({ blend: e.target.value as BlendMode })}
              className="h-6 w-full min-w-0 rounded bg-panel-3 px-1.5 text-[11px] text-fg outline-none"
            >
              {BLEND_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Row>
        )}
        <SliderRow
          label="Opacidad"
          value={pic.opacity}
          min={0}
          max={1}
          step={0.01}
          scale={100}
          unit="%"
          onChange={(v) => set({ opacity: v }, 'op')}
        />
      </Block>

      {kind === 'clip' && video && (
        <CheckSection title="Estabilización" checked={pic.stabilize > 0} onChange={(v) => set({ stabilize: v ? 2 : undefined })}>
          <Segmented
            value={String(pic.stabilize)}
            onChange={(v) => set({ stabilize: Number(v) })}
            options={STABILIZE_LEVELS.map((l, i) => ({ value: String(i + 1), label: l.label }))}
          />
          <Note>Quita el temblor de la cámara. Se aplica al exportar; cuanto más estable, más se recorta el borde de la imagen.</Note>
        </CheckSection>
      )}
      <CheckSection title="Mejorar la calidad" checked={pic.enhance > 0} onChange={(v) => set({ enhance: v ? 0.5 : undefined })}>
        <SliderRow
          label="Intensidad"
          value={pic.enhance}
          min={0.05}
          max={1}
          step={0.01}
          scale={100}
          unit="%"
          onChange={(v) => set({ enhance: v }, 'enh')}
        />
        <Note>Más contraste, color y nitidez. El color se ve ya en el reproductor; la nitidez, en el vídeo exportado.</Note>
      </CheckSection>
      {video && (
        <CheckSection title="Reducir el ruido de la imagen" checked={pic.denoise > 0} onChange={(v) => set({ denoise: v ? 0.5 : undefined })}>
          <SliderRow
            label="Intensidad"
            value={pic.denoise}
            min={0.05}
            max={1}
            step={0.01}
            scale={100}
            unit="%"
            onChange={(v) => set({ denoise: v }, 'den')}
          />
          <Note>Limpia el grano de los vídeos grabados con poca luz. Se aplica al exportar.</Note>
        </CheckSection>
      )}
      {kind === 'clip' && video && (
        <CheckSection title="Flujo óptico" checked={pic.opticalFlow} onChange={(v) => set({ opticalFlow: v || undefined })}>
          <Note>
            Cámara lenta más fluida: al exportar se calculan los fotogramas intermedios en vez de repetirlos. La exportación tarda bastante más.
            {!slowed && ' Este clip no está ralentizado: baja su velocidad en la pestaña Velocidad para que se note.'}
          </Note>
        </CheckSection>
      )}
      <CheckSection title="Ampliación" checked={pic.upscale} onChange={(v) => set({ upscale: v || undefined })}>
        <Note>Amplía con más nitidez las imágenes de poca resolución. Se aplica al exportar (no usa IA).</Note>
      </CheckSection>
    </>
  );
}
