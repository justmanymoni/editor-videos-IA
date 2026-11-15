'use client';
import clsx from 'clsx';
import { MAX_SPEED, MIN_SPEED, clipSpeed } from '@/lib/shared/types';
import { keptRanges } from '@/lib/shared/timeline';
import { selRefs, useEditor } from '@/lib/client/store';
import { setClipSpeed } from '@/lib/client/actions';
import { formatSeconds } from '@/lib/client/format';
import { Section, SliderRow } from '@/components/ui';

const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/** Speed tab: of the selected clips, or of every clip when none is selected. */
export function SpeedPanel() {
  const doc = useEditor((s) => s.doc)!;
  const media = useEditor((s) => s.media);
  const selection = useEditor((s) => s.selection);
  const selectedIds = [...new Set(selRefs(selection).flatMap((r) => (r.kind === 'segment' ? [r.clipId] : [])))];
  const videos = doc.clips.filter((c) => media[c.mediaId]?.kind !== 'image');
  const clips = selectedIds.length ? videos.filter((c) => selectedIds.includes(c.id)) : videos;
  if (!clips.length) {
    return <p className="px-3.5 py-3 text-[11px] leading-relaxed text-faint">Añade un vídeo a la línea de tiempo para cambiar su velocidad.</p>;
  }
  const ids = selectedIds.length ? clips.map((c) => c.id) : null;
  const speed = clipSpeed(clips[0]);
  const mixed = clips.some((c) => clipSpeed(c) !== speed);
  const source = clips.reduce((sum, c) => sum + keptRanges(c).reduce((n, r) => n + r.end - r.start, 0), 0);
  const result = clips.reduce((sum, c) => sum + keptRanges(c).reduce((n, r) => n + r.end - r.start, 0) / clipSpeed(c), 0);
  const set = (v: number, key?: string) => setClipSpeed(ids, v, key);

  return (
    <div className="h-full overflow-y-auto">
      <Section title="Velocidad">
        <p className="text-xs text-muted">
          {selectedIds.length
            ? clips.length > 1
              ? `Se aplica a los ${clips.length} clips seleccionados.`
              : 'Se aplica al clip seleccionado.'
            : 'Se aplica a todos los clips. Selecciona uno en la línea de tiempo para cambiar solo ese.'}
        </p>
        <div className="grid grid-cols-7 gap-1">
          {PRESETS.map((p) => (
            <button
              key={p}
              data-speed={p}
              onClick={() => set(p)}
              onMouseUp={(e) => e.currentTarget.blur()}
              className={clsx(
                'h-7 rounded text-[11px] font-medium tabular-nums transition-colors',
                !mixed && speed === p ? 'bg-accent text-black' : 'bg-panel-3 text-muted hover:text-fg',
              )}
            >
              {p}×
            </button>
          ))}
        </div>
        <SliderRow label="Velocidad" value={speed} min={MIN_SPEED} max={MAX_SPEED} step={0.05} unit="×" onChange={(v) => set(v, 'speed')} />
        <p className="text-[11px] leading-relaxed text-faint">
          Duración: {formatSeconds(source)} → <span className="text-fg">{formatSeconds(result)}</span>
          {mixed && ' (los clips tienen velocidades distintas)'}
        </p>
        <p className="text-[11px] leading-relaxed text-faint">
          La voz conserva su tono. Los subtítulos y la transcripción se ajustan solos a la nueva velocidad; los textos, la música y las
          superposiciones se quedan donde estaban.
        </p>
      </Section>
    </div>
  );
}
