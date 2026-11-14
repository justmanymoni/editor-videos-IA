'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/client/api';
import { useEditor } from '@/lib/client/store';
import { useAutoSilence, useAutosave, useMediaSync, useShortcuts } from '@/lib/client/hooks';
import { refreshResources, uploadClips } from '@/lib/client/actions';
import { player } from '@/lib/client/player';
import { Modal, Toasts } from '@/components/ui';
import { LocalTranscription } from '@/components/LocalTranscription';
import type { ServerStatus } from '@/lib/shared/types';
import { TopBar } from './TopBar';
import { MediaPanel } from './MediaPanel';
import { Preview } from './Preview';
import { SidePanel } from './SidePanel';
import { Timeline } from './Timeline';
import { ExportDialog } from './ExportDialog';
import { ShortcutsHelp } from './ShortcutsHelp';

/** After installing local transcription, reload clip states: the server re-queues pending ones. */
async function onTranscriberInstalled(status: ServerStatus) {
  const s = useEditor.getState();
  s.set({ status });
  if (s.doc) s.upsertMedia(await api.media(s.doc.media));
  s.toast('Transcripción local lista. Tus clips se están transcribiendo.', 'success');
}

export default function Editor({ projectId }: { projectId: string }) {
  const doc = useEditor((s) => s.doc);
  const status = useEditor((s) => s.status);
  const setupOpen = useEditor((s) => s.setupOpen);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    let cancelled = false;
    player.pause();
    (async () => {
      try {
        const project = await api.project(projectId);
        if (cancelled) return;
        const s = useEditor.getState();
        s.set({ media: {}, transcripts: {}, envelopes: {}, uploads: [] });
        s.upsertMedia(await api.media(project.media));
        s.load(project);
        api
          .status()
          .then((status) => useEditor.getState().set({ status }))
          .catch(() => undefined);
        void refreshResources();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useMediaSync();
  useAutoSilence();
  const saveNow = useAutosave();
  const openHelp = useCallback(() => setHelpOpen(true), []);
  useShortcuts(saveNow, openHelp);

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 text-sm">
        <p className="text-danger">{error}</p>
        <Link href="/" className="text-accent underline">
          Volver a los proyectos
        </Link>
      </div>
    );
  }
  if (!doc) return <div className="flex h-screen items-center justify-center text-sm text-muted">Cargando proyecto…</div>;

  const isFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');

  return (
    <div
      className="flex h-screen flex-col overflow-hidden"
      onDragOver={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.relatedTarget) setDragOver(false);
      }}
      onDrop={(e) => {
        setDragOver(false);
        if (!isFileDrag(e) || e.defaultPrevented) return;
        e.preventDefault();
        void uploadClips([...e.dataTransfer.files]);
      }}
    >
      <TopBar onExport={() => setExportOpen(true)} onHelp={openHelp} onSave={saveNow} />
      <div className="flex min-h-0 flex-1">
        <MediaPanel />
        <Preview />
        <SidePanel />
      </div>
      <Timeline />
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center border-4 border-dashed border-accent/70 bg-black/60">
          <p className="rounded-xl bg-panel px-6 py-4 text-lg font-semibold">Suelta los clips para añadirlos al proyecto</p>
        </div>
      )}
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <Modal open={setupOpen} onClose={() => useEditor.getState().set({ setupOpen: false })} title="Transcripción de voz a texto">
        <LocalTranscription status={status} onInstalled={onTranscriberInstalled} />
      </Modal>
      <Toasts />
    </div>
  );
}
