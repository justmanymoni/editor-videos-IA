'use client';
import { useState } from 'react';
import clsx from 'clsx';
import { FileText, Sparkles } from 'lucide-react';
import type { SubtitleStyle, TextCase } from '@/lib/shared/types';
import { DEFAULT_SUBTITLE_STYLE } from '@/lib/shared/types';
import { cssFamily, fontVariant, getFont, isBoldFont } from '@/lib/shared/fonts';
import { SUBTITLE_PRESETS } from '@/lib/shared/subtitle-presets';
import { useEditor } from '@/lib/client/store';
import { downloadText, toggleAutoSubtitles } from '@/lib/client/actions';
import { Button, CheckSection, ColorField, Kbd, MiniToggle, Row, Section, Segmented, SliderRow, Toggle } from '@/components/ui';
import { FontPicker } from './FontPicker';
import { ScriptDialog } from './ScriptDialog';

type Setter = <K extends keyof SubtitleStyle>(key: K, value: SubtitleStyle[K]) => void;

const CASES: [TextCase, string, string][] = [
  ['upper', 'TT', 'TODO EN MAYÚSCULAS'],
  ['lower', 'tt', 'todo en minúsculas'],
  ['title', 'Tt', 'Primera Letra En Mayúscula'],
];

/** "B", "U" and "I", as in CapCut. Bold and italic pick another font of the same family. */
export function DesignButtons({
  fontId,
  underline,
  onFont,
  onUnderline,
}: {
  fontId: string;
  underline?: boolean;
  onFont: (id: string) => void;
  onUnderline?: (v: boolean) => void;
}) {
  const font = getFont(fontId);
  const bold = isBoldFont(font);
  const italic = !!font.italic;
  const toBold = fontVariant(fontId, { bold: !bold, italic: false });
  const toItalic = fontVariant(fontId, { italic: !italic });
  return (
    <>
      <MiniToggle
        active={bold}
        disabled={!toBold}
        onClick={() => toBold && onFont(toBold)}
        label={toBold ? 'Negrita' : 'Esta fuente no tiene otra variante de grosor'}
      >
        <b>B</b>
      </MiniToggle>
      {onUnderline && (
        <MiniToggle active={!!underline} onClick={() => onUnderline(!underline)} label="Subrayado">
          <u>U</u>
        </MiniToggle>
      )}
      <MiniToggle
        active={italic}
        disabled={!toItalic}
        onClick={() => toItalic && onFont(toItalic)}
        label={toItalic ? 'Cursiva' : 'Esta fuente no tiene cursiva'}
      >
        <i className="font-serif">I</i>
      </MiniToggle>
    </>
  );
}

/** Colour, opacity, blur, distance and angle of a shadow (the same controls for subtitles and texts). */
export function ShadowControls<T extends { shadow: number; shadowColor: string; shadowOpacity: number; shadowBlur: number; shadowAngle: number }>({
  value,
  set,
}: {
  value: T;
  set: (patch: Partial<T>, key: string) => void;
}) {
  return (
    <>
      <Row label="Color">
        <ColorField value={value.shadowColor} onChange={(v) => set({ shadowColor: v } as Partial<T>, 'shc')} />
      </Row>
      <SliderRow
        label="Opacidad"
        value={value.shadowOpacity}
        min={0}
        max={1}
        step={0.01}
        scale={100}
        unit="%"
        onChange={(v) => set({ shadowOpacity: v } as Partial<T>, 'sho')}
      />
      <SliderRow label="Desenfoque" value={value.shadowBlur} min={0} max={40} onChange={(v) => set({ shadowBlur: v } as Partial<T>, 'shb')} />
      <SliderRow label="Distancia" value={value.shadow} min={0} max={40} onChange={(v) => set({ shadow: v } as Partial<T>, 'shd')} />
      <SliderRow
        label="Ángulo"
        value={value.shadowAngle}
        min={-180}
        max={180}
        unit="°"
        onChange={(v) => set({ shadowAngle: v } as Partial<T>, 'sha')}
      />
    </>
  );
}

/** The settings used most, in the order of CapCut's "Básico" tab. */
function Basic({ style, set }: { style: SubtitleStyle; set: Setter }) {
  const hasScript = useEditor((s) => !!s.doc?.script.trim());
  const [scriptOpen, setScriptOpen] = useState(false);
  const patch = (p: Partial<SubtitleStyle>, key: string) => useEditor.getState().commit((d) => void Object.assign(d.subtitles, p), `style:${key}`);
  return (
    <>
      <Section title="Subtítulos automáticos">
        {style.enabled ? (
          <Toggle label="Mostrar los subtítulos en el vídeo" checked onChange={toggleAutoSubtitles} />
        ) : (
          <Button data-auto-subtitles variant="primary" size="sm" className="self-start" onClick={toggleAutoSubtitles}>
            Añadir subtítulos automáticamente <Kbd>G</Kbd>
          </Button>
        )}
        <p className="text-[11px] leading-relaxed text-faint">
          Se crean con la voz para todo el vídeo. En el vídeo, arrástralos para moverlos y haz doble clic para cambiar su texto.
        </p>
      </Section>

      <div className={clsx(!style.enabled && 'pointer-events-none opacity-40')}>
        <Section title="Texto">
          <Row label="Fuente">
            <FontPicker value={style.fontId} onChange={(v) => set('fontId', v)} />
          </Row>
          <SliderRow label="Tamaño" value={style.fontSize} min={30} max={200} onChange={(v) => set('fontSize', v)} />
          <Row label="Diseño">
            <DesignButtons
              fontId={style.fontId}
              underline={style.underline}
              onFont={(v) => set('fontId', v)}
              onUnderline={(v) => set('underline', v)}
            />
          </Row>
          <Row label="May./min.">
            {CASES.map(([value, short, label]) => (
              <MiniToggle
                key={value}
                active={style.textCase === value}
                onClick={() => set('textCase', style.textCase === value ? 'none' : value)}
                label={label}
              >
                <span className="font-semibold">{short}</span>
              </MiniToggle>
            ))}
          </Row>
          <Row label="Color">
            <ColorField value={style.textColor} onChange={(v) => set('textColor', v)} />
          </Row>
          <SliderRow label="Carácter" value={style.letterSpacing} min={-10} max={40} onChange={(v) => set('letterSpacing', v)} />
        </Section>

        <CheckSection title="Trazo" checked={style.outlineWidth > 0} onChange={(v) => set('outlineWidth', v ? 6 : 0)}>
          <Row label="Color">
            <ColorField value={style.outlineColor} onChange={(v) => set('outlineColor', v)} />
          </Row>
          <SliderRow label="Grosor" value={style.outlineWidth} min={1} max={16} onChange={(v) => set('outlineWidth', v)} />
        </CheckSection>

        <CheckSection title="Sombra" checked={style.shadowOn} onChange={(v) => set('shadowOn', v)}>
          <ShadowControls value={style} set={patch} />
        </CheckSection>

        <CheckSection title="Resaltar la palabra que suena" checked={style.highlight} onChange={(v) => set('highlight', v)}>
          <Row label="Estilo">
            <Segmented
              value={style.highlightBox ? 'box' : 'color'}
              onChange={(v) => set('highlightBox', v === 'box')}
              options={[
                { value: 'color', label: 'Color' },
                { value: 'box', label: 'Caja' },
              ]}
            />
          </Row>
          <Row label={style.highlightBox ? 'Color de la caja' : 'Color'}>
            <ColorField value={style.highlightColor} onChange={(v) => set('highlightColor', v)} />
          </Row>
          {style.highlightBox && (
            <Row label="Texto en la caja">
              <ColorField value={style.boxTextColor} onChange={(v) => set('boxTextColor', v)} />
            </Row>
          )}
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
        </CheckSection>

        <Section title="Separación">
          <Row label="Palabras">
            <Segmented
              value={String(Math.min(style.wordsPerPage, 6))}
              onChange={(v) => set('wordsPerPage', Number(v))}
              options={['1', '2', '3', '4', '5', '6'].map((n) => ({ value: n, label: n }))}
            />
          </Row>
          <SliderRow label="Letras por línea" value={style.maxCharsPerLine} min={6} max={40} onChange={(v) => set('maxCharsPerLine', v)} />
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

        <Section title="Más">
          <Toggle label="Atenuar las palabras que aún no se han dicho" checked={style.dimUpcoming} onChange={(v) => set('dimUpcoming', v)} />
          <Toggle label="Quitar puntuación" checked={style.stripPunctuation} onChange={(v) => set('stripPunctuation', v)} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => useEditor.getState().set({ inspectorTab: 'animation' })}>
              <Sparkles size={12} /> Elegir animación
            </Button>
            <Button size="sm" onClick={() => setScriptOpen(true)} title="Pega tu guión para que los subtítulos usen tus palabras exactas">
              <FileText size={12} /> Usar mi guión
            </Button>
            {hasScript && (
              <Button size="sm" variant="ghost" onClick={() => downloadText('script')}>
                Descargar guión
              </Button>
            )}
          </div>
          <ScriptDialog open={scriptOpen} onClose={() => setScriptOpen(false)} />
        </Section>
      </div>
    </>
  );
}

const CASE_CSS: Record<TextCase, 'none' | 'uppercase' | 'lowercase' | 'capitalize'> = {
  none: 'none',
  upper: 'uppercase',
  lower: 'lowercase',
  title: 'capitalize',
};

/** Ready-made looks. One click replaces the whole style (the position is kept). */
function Styles({ current }: { current: SubtitleStyle }) {
  const apply = (p: Partial<SubtitleStyle>) =>
    useEditor
      .getState()
      .commit(
        (d) =>
          void (d.subtitles = { ...DEFAULT_SUBTITLE_STYLE, ...p, enabled: true, positionX: d.subtitles.positionX, positionY: d.subtitles.positionY }),
      );
  return (
    <Section title="Estilos">
      <div className="grid grid-cols-3 gap-1.5">
        {SUBTITLE_PRESETS.map((p) => {
          const merged = { ...DEFAULT_SUBTITLE_STYLE, ...p.style };
          return (
            <button
              key={p.id}
              data-subtitle-preset={p.id}
              onClick={() => apply(p.style)}
              onMouseUp={(e) => e.currentTarget.blur()}
              className="rounded bg-[#3a3a3a] px-1 py-2 text-center hover:ring-1 hover:ring-accent"
            >
              <span
                className="sub-text block text-[13px] leading-tight"
                style={{
                  fontFamily: `"${cssFamily(getFont(merged.fontId))}"`,
                  WebkitTextStroke: merged.outlineWidth > 0 ? '2.5px #000' : undefined,
                  textShadow: merged.shadowOn ? (merged.shadowBlur > 0 ? '1px 1px 3px rgba(0,0,0,0.9)' : '1px 1px 0 rgba(0,0,0,0.6)') : undefined,
                  color: '#fff',
                  textTransform: CASE_CSS[merged.textCase],
                }}
              >
                <span>Hola</span>{' '}
                <span
                  style={
                    merged.highlight && merged.highlightBox
                      ? { background: merged.highlightColor, color: merged.boxTextColor, WebkitTextStroke: '0', textShadow: 'none', padding: '0 3px' }
                      : { color: merged.highlight ? merged.highlightColor : undefined }
                  }
                >
                  tú
                </span>
                {merged.dimUpcoming && <span style={{ opacity: 0.4 }}> ya</span>}
              </span>
              <span className="mt-1 block text-[10px] text-muted">{p.name}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] leading-relaxed text-faint">
        Al elegir uno se cambia todo el estilo (fuente, colores, trazo, sombra…). Después puedes retocarlo en «Básico».
        {!current.enabled && ' También enciende los subtítulos.'}
      </p>
    </Section>
  );
}

/** Subtitles tab: the basic settings, and the ready-made styles in their own sub-tab. */
export function SubtitleStylePanel() {
  const style = useEditor((s) => s.doc!.subtitles);
  const [tab, setTab] = useState<'basic' | 'styles'>('basic');
  const set: Setter = (key, value) => useEditor.getState().commit((d) => void (d.subtitles[key] = value), `style:${key}`);
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-line px-3.5 py-2" data-subtitle-tabs>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'basic', label: 'Básico' },
            { value: 'styles', label: 'Estilos' },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{tab === 'basic' ? <Basic style={style} set={set} /> : <Styles current={style} />}</div>
    </div>
  );
}
