'use client';
import { AlignCenterHorizontal, AlignCenterVertical, Maximize, Scissors, Trash2 } from 'lucide-react';
import type { AudioItem, BrollItem, MainClip, TextItem } from '@/lib/shared/types';
import { useEditor } from '@/lib/client/store';
import { deleteSelection, splitTextBySlashes, updateItem, type ItemKind } from '@/lib/client/actions';
import { Button, ColorField, Row, Section, Segmented, SliderRow } from '@/components/ui';
import { AudioControls, TranscriptStatus } from './ToolsPanel';
import { FontPicker } from './FontPicker';
import { SHAPES, SHAPE_OPTIONS, type TextShape } from './TextTab';

/** Start and duration on the timeline, in seconds. */
function Timing({ kind, item }: { kind: ItemKind; item: { id: string; start: number; duration: number } }) {
  const field = (label: string, value: number, apply: (v: number) => void, min: number) => (
    <Row label={label}>
      <input
        type="number"
        min={min}
        step={0.1}
        value={Math.round(value * 100) / 100}
        onChange={(e) => Number.isFinite(e.target.valueAsNumber) && apply(Math.max(min, e.target.valueAsNumber))}
        className="h-6 w-20 rounded bg-panel-3 px-1.5 text-right text-[11px] text-fg tabular-nums outline-none"
      />
      <span className="text-[11px] text-faint">s</span>
    </Row>
  );
  return (
    <>
      {field('Empieza en', item.start, (v) => updateItem(kind, item.id, { start: v }, `start:${item.id}`), 0)}
      {field('Duración', item.duration, (v) => updateItem(kind, item.id, { duration: v }, `dur:${item.id}`), 0.1)}
    </>
  );
}

const DeleteButton = ({ label }: { label: string }) => (
  <Button variant="danger" size="sm" className="mt-1 self-start" onClick={deleteSelection}>
    <Trash2 size={12} /> {label}
  </Button>
);

/** Position on the frame with centring shortcuts. */
function Position({ kind, item }: { kind: ItemKind; item: { id: string; x?: number; y?: number } }) {
  return (
    <>
      <SliderRow
        label="Horizontal"
        value={item.x ?? 0.5}
        min={-0.2}
        max={1.2}
        step={0.01}
        scale={100}
        unit="%"
        onChange={(v) => updateItem(kind, item.id, { x: v }, `x:${item.id}`)}
      />
      <SliderRow
        label="Vertical"
        value={item.y ?? 0.5}
        min={-0.2}
        max={1.2}
        step={0.01}
        scale={100}
        unit="%"
        onChange={(v) => updateItem(kind, item.id, { y: v }, `y:${item.id}`)}
      />
      <Row label="Centrar">
        <Button size="sm" onClick={() => updateItem(kind, item.id, { x: 0.5 })} title="Centrar a lo ancho">
          <AlignCenterHorizontal size={12} /> Ancho
        </Button>
        <Button size="sm" onClick={() => updateItem(kind, item.id, { y: 0.5 })} title="Centrar a lo alto">
          <AlignCenterVertical size={12} /> Alto
        </Button>
      </Row>
    </>
  );
}

function TextProps({ item }: { item: TextItem }) {
  const set = (patch: Partial<TextItem>, key: string) => updateItem('text', item.id, patch, `${key}:${item.id}`);
  const shape: TextShape = item.curve === 'none' ? 'none' : item.curve === 'wave' ? 'wave' : Math.abs(item.curveAmount) >= 100 ? 'circle' : 'arc';
  return (
    <>
      <Section title="Texto">
        <textarea
          value={item.text}
          onChange={(e) => set({ text: e.target.value }, 'text')}
          rows={3}
          className="w-full resize-y rounded bg-panel-3 p-2 text-xs leading-relaxed outline-none focus:ring-1 focus:ring-accent"
        />
        {item.text.includes('/') && (
          <Button size="sm" variant="primary" className="self-start" onClick={() => splitTextBySlashes(item.id)}>
            <Scissors size={12} /> Dividir en bloques por las barras /
          </Button>
        )}
        <Row label="Fuente">
          <FontPicker value={item.fontId} onChange={(v) => set({ fontId: v }, 'font')} />
        </Row>
        <Row label="Color">
          <ColorField value={item.color} onChange={(v) => set({ color: v }, 'color')} />
        </Row>
        <Row label="Contorno">
          <ColorField value={item.outlineColor} onChange={(v) => set({ outlineColor: v }, 'ocolor')} />
        </Row>
        <SliderRow label="Grosor contorno" value={item.outlineWidth} min={0} max={24} onChange={(v) => set({ outlineWidth: v }, 'ow')} />
        <SliderRow label="Sombra" value={item.shadow} min={0} max={24} onChange={(v) => set({ shadow: v }, 'shadow')} />
      </Section>
      <Section title="Tamaño y giro">
        <SliderRow
          label="Tamaño"
          value={item.scale}
          min={0.2}
          max={4}
          step={0.02}
          scale={100}
          unit="%"
          onChange={(v) => set({ scale: v }, 'scale')}
        />
        <SliderRow label="Giro" value={item.rotation} min={-180} max={180} unit="°" onChange={(v) => set({ rotation: v }, 'rot')} />
      </Section>
      <Section title="Forma">
        <Segmented value={shape} onChange={(v) => updateItem('text', item.id, SHAPES[v])} options={SHAPE_OPTIONS} />
        {item.curve !== 'none' && (
          <SliderRow
            label={item.curve === 'wave' ? 'Altura' : 'Curvatura'}
            value={item.curveAmount}
            min={-100}
            max={100}
            onChange={(v) => set({ curveAmount: v }, 'curve')}
          />
        )}
      </Section>
      <Section title="Posición y tiempo">
        <Position kind="text" item={item} />
        <Timing kind="text" item={item} />
        <DeleteButton label="Eliminar texto" />
      </Section>
    </>
  );
}

function OverlayProps({ item }: { item: BrollItem }) {
  const name = useEditor((s) => s.media[item.mediaId]?.name);
  return (
    <>
      <Section title="Superposición">
        <p className="truncate text-xs text-muted" title={name}>
          {name}
        </p>
        <SliderRow
          label="Tamaño"
          value={item.scale ?? 1}
          min={0.05}
          max={3}
          step={0.01}
          scale={100}
          unit="%"
          onChange={(v) => updateItem('broll', item.id, { scale: v }, `scale:${item.id}`)}
        />
        <Button size="sm" className="self-start" onClick={() => updateItem('broll', item.id, { x: 0.5, y: 0.5, scale: 1 })}>
          <Maximize size={12} /> Pantalla completa
        </Button>
      </Section>
      <Section title="Posición y tiempo">
        <Position kind="broll" item={item} />
        <Timing kind="broll" item={item} />
        <DeleteButton label="Eliminar superposición" />
      </Section>
    </>
  );
}

function AudioProps({ item }: { item: AudioItem }) {
  const name = useEditor((s) => s.media[item.mediaId]?.name);
  const set = (patch: Partial<AudioItem>, key: string) => updateItem('audio', item.id, patch, `${key}:${item.id}`);
  return (
    <Section title="Audio">
      <p className="truncate text-xs text-muted" title={name}>
        {name}
      </p>
      <SliderRow label="Volumen" value={item.volume} min={0} max={2} step={0.05} scale={100} unit="%" onChange={(v) => set({ volume: v }, 'vol')} />
      <SliderRow label="Fundido entrada" value={item.fadeIn} min={0} max={5} step={0.1} unit="s" onChange={(v) => set({ fadeIn: v }, 'fi')} />
      <SliderRow label="Fundido salida" value={item.fadeOut} min={0} max={5} step={0.1} unit="s" onChange={(v) => set({ fadeOut: v }, 'fo')} />
      <Timing kind="audio" item={item} />
      <DeleteButton label="Eliminar audio" />
    </Section>
  );
}

function ClipProps({ clip }: { clip: MainClip }) {
  const media = useEditor((s) => s.media[clip.mediaId]);
  if (!media) return null;
  return (
    <Section title={media.kind === 'image' ? 'Foto' : 'Clip'}>
      <p className="truncate text-xs text-muted" title={media.name}>
        {media.name}
      </p>
      {media.kind === 'video' && <TranscriptStatus media={media} />}
      {media.hasAudio && media.status !== 'error' && <AudioControls media={media} />}
      <DeleteButton label="Eliminar este fragmento" />
    </Section>
  );
}

function ProjectProps() {
  const settings = useEditor((s) => s.doc!.settings);
  const commit = useEditor((s) => s.commit);
  return (
    <>
      <Section title="Proyecto">
        <Row label="Clips horizontales">
          <Segmented
            value={settings.fitMode}
            onChange={(v) => commit((d) => void (d.settings.fitMode = v))}
            options={[
              { value: 'cover', label: 'Rellenar' },
              { value: 'blur', label: 'Fondo borroso' },
            ]}
          />
        </Row>
        <SliderRow
          label="Volumen original"
          value={settings.mainVolume}
          min={0}
          max={1}
          step={0.05}
          scale={100}
          unit="%"
          onChange={(v) => commit((d) => void (d.settings.mainVolume = v), 'mainVolume')}
        />
        <p className="text-[11px] text-faint">Salida: MP4 vertical 1080×1920 a 30 fps.</p>
      </Section>
      <Section title="Sin selección">
        <p className="text-[11px] leading-relaxed text-muted">
          Selecciona un texto, una superposición, un audio o un clip para ver aquí sus ajustes.
        </p>
      </Section>
    </>
  );
}

/** Settings of whatever is selected, or of the project when nothing is. */
export function Properties() {
  const sel = useEditor((s) => s.selection);
  const doc = useEditor((s) => s.doc)!;
  const text = sel?.kind === 'text' ? doc.texts.find((x) => x.id === sel.id) : undefined;
  const overlay = sel?.kind === 'broll' ? doc.broll.find((x) => x.id === sel.id) : undefined;
  const audio = sel?.kind === 'audio' ? doc.audio.find((x) => x.id === sel.id) : undefined;
  const clip = sel?.kind === 'segment' ? doc.clips.find((x) => x.id === sel.clipId) : undefined;
  return (
    <div className="h-full overflow-y-auto">
      {text ? (
        <TextProps item={text} />
      ) : overlay ? (
        <OverlayProps item={overlay} />
      ) : audio ? (
        <AudioProps item={audio} />
      ) : clip ? (
        <ClipProps clip={clip} />
      ) : (
        <ProjectProps />
      )}
    </div>
  );
}
