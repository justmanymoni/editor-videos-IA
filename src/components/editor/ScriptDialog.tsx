'use client';
import { useEffect, useState } from 'react';
import { useEditor } from '@/lib/client/store';
import { applyScript, saveScript } from '@/lib/client/actions';
import { Button, Modal } from '@/components/ui';

/** Paste the written script: the subtitles take its exact wording, and "/" marks where each block starts. */
export function ScriptDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const saved = useEditor((s) => s.doc?.script ?? '');
  const [text, setText] = useState(saved);
  useEffect(() => {
    if (open) setText(saved);
    // Only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Tu guión" width="max-w-2xl">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-xs leading-relaxed text-muted">
          Pega el texto que has escrito para el vídeo. Se sincroniza con tu voz: los subtítulos usarán exactamente tus palabras, ortografía y
          puntuación, con los tiempos de lo que dices. Lo que digas y no esté en el guión se mantiene tal cual. Hazlo después de limpiar el vídeo.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          placeholder="Hoy el día está nublado y quiero que mañana haga sol…"
          className="w-full resize-y rounded-md border border-line-strong bg-panel-2 p-3 text-sm leading-relaxed focus:border-accent focus:outline-none"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="cursor-pointer text-xs text-muted hover:text-fg">
            <input
              type="file"
              accept=".txt,text/plain"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) setText(await f.text());
              }}
            />
            Abrir un archivo .txt
          </label>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                saveScript(text);
                onClose();
              }}
            >
              Solo guardar
            </Button>
            <Button
              variant="primary"
              disabled={!text.trim()}
              onClick={() => {
                applyScript(text);
                onClose();
              }}
            >
              Aplicar a los subtítulos
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
