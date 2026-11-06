'use client';
import clsx from 'clsx';
import type { SubtitleStyle } from '@/lib/shared/types';
import { DEFAULT_SUBTITLE_STYLE } from '@/lib/shared/types';
import { SUBTITLE_FONTS, cssFamily } from '@/lib/shared/fonts';
import { useEditor } from '@/lib/client/store';
import { ColorField, Field, Segmented, Slider, Toggle } from '@/components/ui';

const PRESETS: { name: string; style: Partial<SubtitleStyle> }[] = [
  { name: 'TikTok amarillo', style: { ...DEFAULT_SUBTITLE_STYLE } },
  {
    name: 'Pop grande',
    style: {
      fontId: 'luckiest-guy',
      fontSize: 96,
      highlightColor: '#FFE600',
      outlineWidth: 7,
      shadow: 6,
      wordsPerPage: 2,
      activeScale: 1.12,
      uppercase: true,
    },
  },
  {
    name: 'Titular',
    style: {
      fontId: 'anton',
      fontSize: 112,
      highlightColor: '#FFE600',
      outlineWidth: 5,
      shadow: 0,
      wordsPerPage: 3,
      maxCharsPerLine: 14,
      uppercase: true,
    },
  },
  {
    name: 'Limpio',
    style: {
      fontId: 'poppins-extrabold',
      fontSize: 72,
      textColor: '#FFFFFF',
      highlightColor: '#FFE600',
      outlineWidth: 4,
      shadow: 3,
      wordsPerPage: 4,
      maxCharsPerLine: 20,
      uppercase: false,
    },
  },
  {
    name: 'Una palabra',
    style: { fontId: 'montserrat-black', fontSize: 120, wordsPerPage: 1, outlineWidth: 8, shadow: 5, positionY: 60, uppercase: true },
  },
];

export function SubtitleStylePanel() {
  const style = useEditor((s) => s.doc!.subtitles);
  const set = <K extends keyof SubtitleStyle>(key: K, value: SubtitleStyle[K]) =>
    useEditor.getState().commit((d) => void (d.subtitles[key] = value), `style:${key}`);
  const applyPreset = (p: Partial<SubtitleStyle>) =>
    useEditor
      .getState()
      .commit((d) => void (d.subtitles = { ...DEFAULT_SUBTITLE_STYLE, ...p, enabled: true, positionY: p.positionY ?? d.subtitles.positionY }));

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <Toggle label="Subtítulos incrustados" checked={style.enabled} onChange={(v) => set('enabled', v)} />

      <div className={clsx('flex flex-col gap-5', !style.enabled && 'pointer-events-none opacity-40')}>
        <div>
          <p className="mb-2 text-xs font-medium text-muted">Estilos rápidos</p>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => applyPreset(p.style)}
                onMouseUp={(e) => e.currentTarget.blur()}
                className="rounded-md border border-line-strong bg-[#2a2a33] px-2 py-2.5 text-center hover:border-accent"
              >
                <span
                  className="sub-text block text-[17px] leading-tight"
                  style={{
                    fontFamily: `"${cssFamily(SUBTITLE_FONTS.find((f) => f.id === (p.style.fontId ?? 'montserrat-black'))!)}"`,
                    WebkitTextStroke: '3px #000',
                    color: p.style.textColor ?? '#fff',
                    textTransform: p.style.uppercase === false ? 'none' : 'uppercase',
                  }}
                >
                  Hola <span style={{ color: p.style.highlightColor ?? '#FFE600' }}>mundo</span>
                </span>
                <span className="mt-1 block text-[10px] text-muted">{p.name}</span>
              </button>
            ))}
          </div>
        </div>

        <Field label="Fuente">
          <select
            value={style.fontId}
            onChange={(e) => set('fontId', e.target.value)}
            className="h-9 rounded-md border border-line-strong bg-panel-2 px-2 text-sm"
            style={{ fontFamily: `"vc-${style.fontId}"` }}
          >
            {SUBTITLE_FONTS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Tamaño" hint={`${style.fontSize} px`}>
          <Slider value={style.fontSize} min={36} max={180} onChange={(v) => set('fontSize', v)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Texto">
            <ColorField value={style.textColor} onChange={(v) => set('textColor', v)} />
          </Field>
          <Field label="Palabra activa">
            <ColorField value={style.highlightColor} onChange={(v) => set('highlightColor', v)} />
          </Field>
          <Field label="Contorno">
            <ColorField value={style.outlineColor} onChange={(v) => set('outlineColor', v)} />
          </Field>
          <Field label="Grosor contorno" hint={`${style.outlineWidth} px`}>
            <Slider value={style.outlineWidth} min={0} max={14} onChange={(v) => set('outlineWidth', v)} />
          </Field>
        </div>

        <Field label="Sombra" hint={`${style.shadow} px`}>
          <Slider value={style.shadow} min={0} max={14} onChange={(v) => set('shadow', v)} />
        </Field>

        <Field label="Posición vertical" hint={`${Math.round(style.positionY)} %`}>
          <Segmented
            value={style.positionY <= 30 ? 'top' : style.positionY >= 62 ? 'bottom' : 'middle'}
            onChange={(v) => set('positionY', v === 'top' ? 20 : v === 'middle' ? 50 : 72)}
            options={[
              { value: 'top', label: 'Arriba' },
              { value: 'middle', label: 'Centro' },
              { value: 'bottom', label: 'Abajo' },
            ]}
          />
          <Slider value={style.positionY} min={8} max={92} onChange={(v) => set('positionY', v)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Palabras por bloque" hint={String(style.wordsPerPage)}>
            <Slider value={style.wordsPerPage} min={1} max={6} onChange={(v) => set('wordsPerPage', v)} />
          </Field>
          <Field label="Letras por línea" hint={String(style.maxCharsPerLine)}>
            <Slider value={style.maxCharsPerLine} min={6} max={32} onChange={(v) => set('maxCharsPerLine', v)} />
          </Field>
        </div>

        <Field label="Escala de la palabra activa" hint={`${Math.round(style.activeScale * 100)} %`}>
          <Slider value={style.activeScale} min={1} max={1.3} step={0.02} onChange={(v) => set('activeScale', v)} />
        </Field>

        <div className="flex flex-col gap-3">
          <Toggle label="Mayúsculas" checked={style.uppercase} onChange={(v) => set('uppercase', v)} />
          <Toggle label="Quitar puntuación" checked={style.stripPunctuation} onChange={(v) => set('stripPunctuation', v)} />
        </div>
        <p className="text-[11px] leading-relaxed text-faint">
          La vista previa usa la misma fuente y métricas que la exportación (FFmpeg + libass), así que lo que ves es lo que se incrusta en el MP4.
        </p>
      </div>
    </div>
  );
}
