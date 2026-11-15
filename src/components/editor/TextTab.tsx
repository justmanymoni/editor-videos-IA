'use client';
import { useState } from 'react';
import { Loader2, Mic, Plus, Square } from 'lucide-react';
import type { TextItem } from '@/lib/shared/types';
import { useEditor } from '@/lib/client/store';
import { useRecorder } from '@/lib/client/recorder';
import { addTextBlocks, dictate } from '@/lib/client/actions';
import { formatTime } from '@/lib/client/format';
import { Button, Segmented } from '@/components/ui';

export type TextShape = 'none' | 'arc' | 'circle' | 'wave';

/** Curve settings for each shape offered in the interface. */
export const SHAPES: Record<TextShape, Pick<TextItem, 'curve' | 'curveAmount'>> = {
  none: { curve: 'none', curveAmount: 50 },
  arc: { curve: 'arc', curveAmount: 50 },
  circle: { curve: 'arc', curveAmount: 100 },
  wave: { curve: 'wave', curveAmount: 60 },
};

export const SHAPE_OPTIONS: { value: TextShape; label: string }[] = [
  { value: 'none', label: 'Recto' },
  { value: 'arc', label: 'Arco' },
  { value: 'circle', label: 'Círculo' },
  { value: 'wave', label: 'Onda' },
];

/** Add manual text by typing or by voice. A slash starts a new block. */
export function TextTab() {
  const [text, setText] = useState('');
  const [shape, setShape] = useState<TextShape>('none');
  const [busy, setBusy] = useState(false);
  const recorder = useRecorder();
  const blocks = text
    .split('/')
    .map((b) => b.trim())
    .filter(Boolean);

  const toggleDictation = async () => {
    const s = useEditor.getState();
    if (s.status?.transcriber === 'none') {
      s.toast('Para dictar hace falta la transcripción local. Instálala primero.');
      return s.set({ setupOpen: true });
    }
    if (!recorder.recording) return void recorder.start();
    setBusy(true);
    const audio = await recorder.stop();
    const said = audio ? await dictate(audio) : null;
    setBusy(false);
    if (said) setText((prev) => (prev.trim() ? `${prev.trimEnd()} ` : '') + said);
    else if (said === '') s.toast('No se ha entendido nada. Habla más cerca del micrófono.');
  };

  const add = () => {
    addTextBlocks(text, SHAPES[shape]);
    setText('');
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="Escribe tu texto o díctalo con el micrófono"
        className="w-full resize-y rounded-md border border-line-strong bg-panel-2 p-2.5 text-sm leading-relaxed focus:border-accent focus:outline-none"
      />
      <div className="flex gap-2">
        <Button variant={recorder.recording ? 'danger' : 'secondary'} className="h-9 flex-1" onClick={toggleDictation} disabled={busy}>
          {busy ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Transcribiendo…
            </>
          ) : recorder.recording ? (
            <>
              <Square size={12} fill="currentColor" /> Parar ({formatTime(recorder.seconds, false)})
            </>
          ) : (
            <>
              <Mic size={14} /> Dictar
            </>
          )}
        </Button>
        <Button variant="primary" className="h-9 flex-1" onClick={add} disabled={!blocks.length}>
          <Plus size={14} /> Añadir{blocks.length > 1 ? ` ${blocks.length} bloques` : ' texto'}
        </Button>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted">Forma</p>
        <Segmented value={shape} onChange={setShape} options={SHAPE_OPTIONS} />
      </div>
      <div className="rounded-md border border-line bg-panel-2 p-2.5 text-[11px] leading-relaxed text-muted">
        <p className="mb-1 font-semibold text-fg">Separa bloques con una barra /</p>
        <p>
          <span className="text-accent">el lobo / enfurecido / está en el bosque</span> crea tres textos seguidos que puedes mover, alargar y editar
          por separado.
        </p>
        <p className="mt-1.5">
          El texto se añade donde está el cursor. Después arrástralo en el vídeo, cámbiale el tamaño con las esquinas o gíralo.
        </p>
      </div>
    </div>
  );
}
