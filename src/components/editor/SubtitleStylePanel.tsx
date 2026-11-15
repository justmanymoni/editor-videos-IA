'use client';
import { useState } from 'react';
import clsx from 'clsx';
import { FileText, Sparkles } from 'lucide-react';
import type { SubtitleStyle } from '@/lib/shared/types';
import { DEFAULT_SUBTITLE_STYLE } from '@/lib/shared/types';
import { cssFamily, getFont } from '@/lib/shared/fonts';
import { useEditor } from '@/lib/client/store';
import { downloadText } from '@/lib/client/actions';
import { Button, ColorField, Row, Section, Segmented, SliderRow, Toggle } from '@/components/ui';
import { FontPicker } from './FontPicker';
import { ScriptDialog } from './ScriptDialog';

const PRESETS: { name: string; style: Partial<SubtitleStyle> }[] = [
  { name: 'Amarillo', style: {} },
  {
    name: 'Limpio',
    style: {
      fontId: 'montserrat-bold',
      fontSize: 68,
      outlineWidth: 4,
      shadow: 2,
      uppercase: false,
      highlight: false,
      wordsPerPage: 4,
      maxCharsPerLine: 20,
    },
  },
  {
    name: 'Clásico',
    style: {
      fontId: 'playfair-italic',
      fontSize: 78,
      outlineWidth: 3,
      shadow: 3,
      uppercase: false,
      highlight: false,
      wordsPerPage: 5,
      maxCharsPerLine: 24,
    },
  },
  { name: 'Titular', style: { fontId: 'anton', fontSize: 110, outlineWidth: 5, shadow: 0, maxCharsPerLine: 14 } },
  {
    name: 'Pop',
    style: { fontId: 'luckiest-guy', fontSize: 96, outlineWidth: 7, shadow: 6, wordsPerPage: 2, activeScale: 1.12, animationIn: 'pop' },
  },
  { name: 'Una palabra', style: { fontSize: 120, wordsPerPage: 1, outlineWidth: 8, shadow: 5, animationIn: 'zoom' } },
];

/** Look, position and animation of the automatic subtitles. */
export function SubtitleStylePanel() {
  const style = useEditor((s) => s.doc!.subtitles);
  const hasScript = useEditor((s) => !!s.doc?.script.trim());
  const [scriptOpen, setScriptOpen] = useState(false);
  const set = <K extends keyof SubtitleStyle>(key: K, value: SubtitleStyle[K]) =>
    useEditor.getState().commit((d) => void (d.subtitles[key] = value), `style:${key}`);
  const applyPreset = (p: Partial<SubtitleStyle>) =>
    useEditor
      .getState()
      .commit(
        (d) =>
          void (d.subtitles = { ...DEFAULT_SUBTITLE_STYLE, ...p, enabled: true, positionX: d.subtitles.positionX, positionY: d.subtitles.positionY }),
      );

  return (
    <div className="h-full overflow-y-auto">
      <Section title="Subtítulos">
        <Toggle label="Mostrar subtítulos en el vídeo" checked={style.enabled} onChange={(v) => set('enabled', v)} />
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setScriptOpen(true)} title="Pega tu guión para que los subtítulos usen tus palabras exactas">
            <FileText size={12} /> Usar mi guión
          </Button>
          {hasScript && (
            <Button size="sm" variant="ghost" onClick={() => downloadText('script')}>
              Descargar guión
            </Button>
          )}
        </div>
        <p className="text-[11px] leading-relaxed text-faint">
          En el vídeo: arrastra el subtítulo para moverlo y haz doble clic para cambiar su texto.
        </p>
        <ScriptDialog open={scriptOpen} onClose={() => setScriptOpen(false)} />
      </Section>

      <div className={clsx(!style.enabled && 'pointer-events-none opacity-40')}>
        <Section title="Separación">
          <Row label="Palabras">
            <Segmented
              value={String(Math.min(style.wordsPerPage, 6))}
              onChange={(v) => set('wordsPerPage', Number(v))}
              options={['1', '2', '3', '4', '5', '6'].map((n) => ({ value: n, label: n }))}
            />
          </Row>
          <p className="text-[11px] leading-relaxed text-faint">
            Los subtítulos se crean solos a partir de la voz, {style.wordsPerPage === 1 ? 'palabra a palabra' : `cada ${style.wordsPerPage} palabras`}
            . Una frase nueva o una pausa empiezan siempre un subtítulo nuevo.
          </p>
          <SliderRow label="Letras por línea" value={style.maxCharsPerLine} min={6} max={40} onChange={(v) => set('maxCharsPerLine', v)} />
        </Section>

        <Section title="Estilos">
          <div className="grid grid-cols-3 gap-1.5">
            {PRESETS.map((p) => {
              const merged = { ...DEFAULT_SUBTITLE_STYLE, ...p.style };
              return (
                <button
                  key={p.name}
                  onClick={() => applyPreset(p.style)}
                  onMouseUp={(e) => e.currentTarget.blur()}
                  className="rounded bg-[#333336] px-1 py-2 text-center hover:ring-1 hover:ring-accent"
                >
                  <span
                    className="sub-text block text-[13px] leading-tight"
                    style={{
                      fontFamily: `"${cssFamily(getFont(merged.fontId))}"`,
                      WebkitTextStroke: '2.5px #000',
                      color: '#fff',
                      textTransform: merged.uppercase ? 'uppercase' : 'none',
                    }}
                  >
                    Hola <span style={{ color: merged.highlight ? merged.highlightColor : undefined }}>tú</span>
                  </span>
                  <span className="mt-1 block text-[10px] text-muted">{p.name}</span>
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Texto">
          <Row label="Fuente">
            <FontPicker value={style.fontId} onChange={(v) => set('fontId', v)} />
          </Row>
          <SliderRow label="Tamaño" value={style.fontSize} min={30} max={200} onChange={(v) => set('fontSize', v)} />
          <Row label="Color">
            <ColorField value={style.textColor} onChange={(v) => set('textColor', v)} />
          </Row>
          <Row label="Contorno">
            <ColorField value={style.outlineColor} onChange={(v) => set('outlineColor', v)} />
          </Row>
          <SliderRow label="Grosor contorno" value={style.outlineWidth} min={0} max={16} onChange={(v) => set('outlineWidth', v)} />
          <SliderRow label="Sombra" value={style.shadow} min={0} max={16} onChange={(v) => set('shadow', v)} />
          <Toggle label="Mayúsculas" checked={style.uppercase} onChange={(v) => set('uppercase', v)} />
          <Toggle label="Quitar puntuación" checked={style.stripPunctuation} onChange={(v) => set('stripPunctuation', v)} />
        </Section>

        <Section title="Palabra que suena">
          <Toggle label="Resaltar la palabra mientras se dice" checked={style.highlight} onChange={(v) => set('highlight', v)} />
          {style.highlight && (
            <>
              <Row label="Color">
                <ColorField value={style.highlightColor} onChange={(v) => set('highlightColor', v)} />
              </Row>
              <SliderRow
                label="Agrandar"
                value={style.activeScale}
                min={1}
                max={1.4}
                step={0.02}
                scale={100}
                unit="%"
                onChange={(v) => set('activeScale', v)}
              />
            </>
          )}
        </Section>

        <Section title="Posición">
          <Segmented
            value={style.positionY <= 30 ? 'top' : style.positionY >= 62 ? 'bottom' : 'middle'}
            onChange={(v) => {
              set('positionX', 50);
              set('positionY', v === 'top' ? 20 : v === 'middle' ? 50 : 72);
            }}
            options={[
              { value: 'top', label: 'Arriba' },
              { value: 'middle', label: 'Centro' },
              { value: 'bottom', label: 'Abajo' },
            ]}
          />
          <SliderRow label="Horizontal" value={style.positionX} min={0} max={100} unit="%" onChange={(v) => set('positionX', v)} />
          <SliderRow label="Vertical" value={style.positionY} min={0} max={100} unit="%" onChange={(v) => set('positionY', v)} />
        </Section>

        <Section title="Animación">
          <Button size="sm" className="self-start" onClick={() => useEditor.getState().set({ inspectorTab: 'animation' })}>
            <Sparkles size={12} /> Elegir animación
          </Button>
        </Section>
      </div>
    </div>
  );
}
