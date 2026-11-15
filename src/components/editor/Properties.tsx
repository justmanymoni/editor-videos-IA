'use client';
import { AlignCenterHorizontal, AlignCenterVertical, AudioLines, Maximize, Scissors, Sparkles, Trash2 } from 'lucide-react';
import type { AudioItem, BrollItem, MainClip, TextItem } from '@/lib/shared/types';
import { selRefs, useEditor, type SelRef } from '@/lib/client/store';
import {
  deleteSelection,
  pickItems,
  setItemsDuration,
  splitTextBySlashes,
  updateItem,
  updateItems,
  type ItemKind,
  type ItemPatch,
} from '@/lib/client/actions';
import { Button, ColorField, Row, Section, Segmented, SliderRow, Toggle } from '@/components/ui';
import { TranscriptStatus } from './ToolsPanel';
import { FontPicker } from './FontPicker';
import { SHAPES, SHAPE_OPTIONS, type TextShape } from './TextTab';

/**
 * Every control below works on a list of items: the values shown are those of
 * the first one and a change is applied to all of them as one undo step.
 */
function patchAll(kind: ItemKind, items: { id: string }[], patch: ItemPatch, key?: string) {
  updateItems(
    items.map((x) => ({ kind, id: x.id, patch })),
    key && `${key}:${items.length}:${items[0]?.id}`,
  );
}

const numberField = 'h-6 w-20 rounded bg-panel-3 px-1.5 text-right text-[11px] text-fg tabular-nums outline-none';

function SecondsField({ label, value, min, onChange }: { label: string; value: number; min: number; onChange: (v: number) => void }) {
  return (
    <Row label={label}>
      <input
        type="number"
        min={min}
        step={0.1}
        value={Math.round(value * 100) / 100}
        onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange(Math.max(min, e.target.valueAsNumber))}
        className={numberField}
      />
      <span className="text-[11px] text-faint">s</span>
    </Row>
  );
}

/** Start and duration on the timeline, in seconds. */
function Timing({ kind, item }: { kind: ItemKind; item: { id: string; start: number; duration: number } }) {
  return (
    <>
      <SecondsField label="Empieza en" value={item.start} min={0} onChange={(v) => updateItem(kind, item.id, { start: v }, `start:${item.id}`)} />
      <SecondsField label="Duración" value={item.duration} min={0.1} onChange={(v) => updateItem(kind, item.id, { duration: v }, `dur:${item.id}`)} />
    </>
  );
}

const DeleteButton = ({ label }: { label: string }) => (
  <Button variant="danger" size="sm" className="mt-1 self-start" onClick={deleteSelection}>
    <Trash2 size={12} /> {label}
  </Button>
);

/** Position on the frame with centring shortcuts. */
function Position({ kind, items }: { kind: ItemKind; items: { id: string; x?: number; y?: number }[] }) {
  const first = items[0];
  return (
    <>
      <SliderRow
        label="Horizontal"
        value={first.x ?? 0.5}
        min={-0.2}
        max={1.2}
        step={0.01}
        scale={100}
        unit="%"
        onChange={(v) => patchAll(kind, items, { x: v }, 'x')}
      />
      <SliderRow
        label="Vertical"
        value={first.y ?? 0.5}
        min={-0.2}
        max={1.2}
        step={0.01}
        scale={100}
        unit="%"
        onChange={(v) => patchAll(kind, items, { y: v }, 'y')}
      />
      <Row label="Centrar">
        <Button size="sm" onClick={() => patchAll(kind, items, { x: 0.5 })} title="Centrar a lo ancho">
          <AlignCenterHorizontal size={12} /> Ancho
        </Button>
        <Button size="sm" onClick={() => patchAll(kind, items, { y: 0.5 })} title="Centrar a lo alto">
          <AlignCenterVertical size={12} /> Alto
        </Button>
      </Row>
    </>
  );
}

/** Font, colours, size, rotation and shape of one or several texts. */
function TextStyle({ items }: { items: TextItem[] }) {
  const item = items[0];
  const set = (patch: Partial<TextItem>, key?: string) => patchAll('text', items, patch, key);
  const shape: TextShape = item.curve === 'none' ? 'none' : item.curve === 'wave' ? 'wave' : Math.abs(item.curveAmount) >= 100 ? 'circle' : 'arc';
  return (
    <>
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
      <Toggle
        label="Fondo (caja detrás del texto)"
        checked={!!item.bgColor}
        onChange={(v) => set(v ? { bgColor: '#FFE600', color: '#000000', outlineWidth: 0, shadow: 0 } : { bgColor: '' })}
      />
      {item.bgColor && (
        <>
          <Row label="Color del fondo">
            <ColorField value={item.bgColor} onChange={(v) => set({ bgColor: v }, 'bg')} />
          </Row>
          <SliderRow
            label="Esquinas"
            value={item.bgRadius}
            min={0}
            max={1}
            step={0.05}
            scale={100}
            unit="%"
            onChange={(v) => set({ bgRadius: v }, 'bgr')}
          />
          <SliderRow
            label="Margen"
            value={item.bgPadding}
            min={0}
            max={1}
            step={0.05}
            scale={100}
            unit="%"
            onChange={(v) => set({ bgPadding: v }, 'bgp')}
          />
          {item.curve !== 'none' && <p className="text-[11px] text-faint">El fondo solo se dibuja en textos rectos.</p>}
        </>
      )}
      <SliderRow label="Tamaño" value={item.scale} min={0.2} max={4} step={0.02} scale={100} unit="%" onChange={(v) => set({ scale: v }, 'scale')} />
      <SliderRow label="Giro" value={item.rotation} min={-180} max={180} unit="°" onChange={(v) => set({ rotation: v }, 'rot')} />
      <Row label="Forma">
        <Segmented value={shape} onChange={(v) => set(SHAPES[v])} options={SHAPE_OPTIONS} />
      </Row>
      {item.curve !== 'none' && (
        <SliderRow
          label={item.curve === 'wave' ? 'Altura' : 'Curvatura'}
          value={item.curveAmount}
          min={-100}
          max={100}
          onChange={(v) => set({ curveAmount: v }, 'curve')}
        />
      )}
    </>
  );
}

function TextProps({ item }: { item: TextItem }) {
  return (
    <>
      <Section title="Texto">
        <textarea
          value={item.text}
          onChange={(e) => updateItem('text', item.id, { text: e.target.value }, `text:${item.id}`)}
          rows={3}
          className="w-full resize-y rounded bg-panel-3 p-2 text-xs leading-relaxed outline-none focus:ring-1 focus:ring-accent"
        />
        {item.text.includes('/') && (
          <Button size="sm" variant="primary" className="self-start" onClick={() => splitTextBySlashes(item.id)}>
            <Scissors size={12} /> Dividir en bloques por las barras /
          </Button>
        )}
        <TextStyle items={[item]} />
      </Section>
      <Section title="Posición y tiempo">
        <Position kind="text" items={[item]} />
        <Timing kind="text" item={item} />
        <Button size="sm" className="self-start" onClick={() => useEditor.getState().set({ inspectorTab: 'animation' })}>
          <Sparkles size={12} /> Animación de entrada y salida
        </Button>
        <DeleteButton label="Eliminar texto" />
      </Section>
    </>
  );
}

function OverlayStyle({ items }: { items: BrollItem[] }) {
  return (
    <>
      <SliderRow
        label="Tamaño"
        value={items[0].scale ?? 1}
        min={0.05}
        max={3}
        step={0.01}
        scale={100}
        unit="%"
        onChange={(v) => patchAll('broll', items, { scale: v }, 'scale')}
      />
      <Button size="sm" className="self-start" onClick={() => patchAll('broll', items, { x: 0.5, y: 0.5, scale: 1 })}>
        <Maximize size={12} /> Pantalla completa
      </Button>
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
        <OverlayStyle items={[item]} />
      </Section>
      <Section title="Posición y tiempo">
        <Position kind="broll" items={[item]} />
        <Timing kind="broll" item={item} />
        <DeleteButton label="Eliminar superposición" />
      </Section>
    </>
  );
}

function AudioStyle({ items }: { items: AudioItem[] }) {
  const item = items[0];
  const set = (patch: Partial<AudioItem>, key: string) => patchAll('audio', items, patch, key);
  return (
    <>
      <SliderRow label="Volumen" value={item.volume} min={0} max={2} step={0.05} scale={100} unit="%" onChange={(v) => set({ volume: v }, 'vol')} />
      <SliderRow label="Fundido entrada" value={item.fadeIn} min={0} max={5} step={0.1} unit="s" onChange={(v) => set({ fadeIn: v }, 'fi')} />
      <SliderRow label="Fundido salida" value={item.fadeOut} min={0} max={5} step={0.1} unit="s" onChange={(v) => set({ fadeOut: v }, 'fo')} />
    </>
  );
}

export function AudioProps({ item }: { item: AudioItem }) {
  const name = useEditor((s) => s.media[item.mediaId]?.name);
  return (
    <Section title="Audio">
      <p className="truncate text-xs text-muted" title={name}>
        {name}
      </p>
      <AudioStyle items={[item]} />
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
      {media.kind === 'video' && media.hasAudio && (
        <Button size="sm" className="self-start" onClick={() => useEditor.getState().set({ inspectorTab: 'audio' })}>
          <AudioLines size={12} /> Voz y música
        </Button>
      )}
      <DeleteButton label="Eliminar este fragmento" />
    </Section>
  );
}

const count = (n: number, one: string, many: string) => (n > 0 ? `${n} ${n === 1 ? one : many}` : null);

/** Several elements selected at once: what they share can be changed for all of them. */
function MultiProps({ refs }: { refs: SelRef[] }) {
  const doc = useEditor((s) => s.doc)!;
  const picked = pickItems(doc, refs);
  const texts = picked.filter((x) => x.kind === 'text').map((x) => x.item as TextItem);
  const overlays = picked.filter((x) => x.kind === 'broll').map((x) => x.item as BrollItem);
  const audios = picked.filter((x) => x.kind === 'audio').map((x) => x.item as AudioItem);
  const summary = [
    count(texts.length, 'texto', 'textos'),
    count(refs.filter((r) => r.kind === 'subtitle').length, 'subtítulo', 'subtítulos'),
    count(overlays.length, 'superposición', 'superposiciones'),
    count(refs.filter((r) => r.kind === 'segment').length, 'clip', 'clips'),
    count(audios.length, 'audio', 'audios'),
  ].filter(Boolean);
  return (
    <>
      <Section title={`${refs.length} elementos seleccionados`}>
        <p className="text-xs text-muted">{summary.join(' · ')}</p>
        <p className="text-[11px] leading-relaxed text-faint">
          Lo que cambies aquí se aplica a todos a la vez. Arrastra uno en la línea de tiempo o en el vídeo para moverlos juntos.
        </p>
        <DeleteButton label="Eliminar todo lo seleccionado" />
      </Section>
      {texts.length > 0 && (
        <Section title={`Textos (${texts.length})`}>
          <TextStyle items={texts} />
          <Position kind="text" items={texts} />
        </Section>
      )}
      {overlays.length > 0 && (
        <Section title={`Superposiciones (${overlays.length})`}>
          <OverlayStyle items={overlays} />
          <Position kind="broll" items={overlays} />
        </Section>
      )}
      {audios.length > 0 && (
        <Section title={`Audios (${audios.length})`}>
          <AudioStyle items={audios} />
        </Section>
      )}
      {picked.length > 0 && (
        <Section title="Tiempo">
          <SecondsField
            label="Duración de cada uno"
            value={picked[0].item.duration}
            min={0.1}
            onChange={(v) => setItemsDuration(refs, v, `multidur:${refs.length}`)}
          />
          <p className="text-[11px] text-faint">Los que iban seguidos siguen seguidos, sin huecos.</p>
        </Section>
      )}
    </>
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
        <p className="text-[11px] text-faint">Salida: MP4 vertical 1080×1920 a 30 fps.</p>
      </Section>
      <Section title="Sin selección">
        <p className="text-[11px] leading-relaxed text-muted">
          Selecciona un texto, una superposición, un audio o un clip para ver aquí sus ajustes. Arrastrando en un hueco de la línea de tiempo
          seleccionas varios a la vez.
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
  const clip = sel?.kind === 'segment' ? doc.clips.find((x) => x.id === sel.clipId) : undefined;
  return (
    <div className="h-full overflow-y-auto">
      {sel?.kind === 'multi' ? (
        <MultiProps refs={selRefs(sel)} />
      ) : text ? (
        <TextProps item={text} />
      ) : overlay ? (
        <OverlayProps item={overlay} />
      ) : clip ? (
        <ClipProps clip={clip} />
      ) : (
        <ProjectProps />
      )}
    </div>
  );
}
