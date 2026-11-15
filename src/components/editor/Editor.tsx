'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/client/api';
import { useEditor } from '@/lib/client/store';
import { useAutoSilence, useAutosave, useMediaSync, useMixPreviews, useShortcuts } from '@/lib/client/hooks';
import { refreshResources, uploadClips } from '@/lib/client/actions';
import { player, usePlayback } from '@/lib/client/player';
import { Modal, Toasts } from '@/components/ui';
import { LocalTranscription } from '@/components/LocalTranscription';
import type { ServerStatus } from '@/lib/shared/types';
import { TopBar } from './TopBar';
import { ToolsPanel } from './ToolsPanel';
import { PLAYER_CONTROLS, PLAYER_PADDING, Preview } from './Preview';
import { InspectorPanel } from './InspectorPanel';
import { useLayout } from '@/lib/client/layout';
import { clamp } from '@/lib/shared/ranges';
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

const DIVIDER = 5;
const MIN_TOOLS = 250;
const MIN_SIDE = 300;
const MIN_PLAYER = 200;
const MIN_TIMELINE = 170;

/** Draggable border between two panels. Double click returns it to the automatic size. */
function Divider({
  axis,
  start,
  onChange,
  onReset,
}: {
  axis: 'x' | 'y';
  start: () => number;
  onChange: (value: number) => void;
  onReset: () => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      title="Arrastra para cambiar el tamaño · doble clic para el tamaño automático"
      onDoubleClick={onReset}
      onPointerDown={(e) => {
        e.preventDefault();
        const origin = axis === 'x' ? e.clientX : e.clientY;
        const base = start();
        const move = (ev: PointerEvent) => onChange(base + (axis === 'x' ? ev.clientX : ev.clientY) - origin);
        const up = () => {
          window.removeEventListener('pointermove', move);
          document.body.style.cursor = '';
        };
        document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up, { once: true });
      }}
      className={
        axis === 'x'
          ? 'z-10 shrink-0 cursor-col-resize bg-line transition-colors hover:bg-accent active:bg-accent'
          : 'z-10 shrink-0 cursor-row-resize bg-line transition-colors hover:bg-accent active:bg-accent'
      }
      style={axis === 'x' ? { width: DIVIDER } : { height: DIVIDER }}
    />
  );
}

export default function Editor({ projectId }: { projectId: string }) {
  const doc = useEditor((s) => s.doc);
  const status = useEditor((s) => s.status);
  const setupOpen = useEditor((s) => s.setupOpen);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [layout, setLayout] = useLayout();
  const rowRef = useRef<HTMLDivElement>(null);
  const [row, setRow] = useState({ w: 1280, h: 480 });

  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const update = () => setRow({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc !== null]);

  useEffect(() => {
    let cancelled = false;
    player.pause();
    (async () => {
      try {
        const project = await api.project(projectId);
        if (cancelled) return;
        const s = useEditor.getState();
        s.set({ media: {}, transcripts: {}, envelopes: {}, uploads: [], mixUrls: {} });
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
  useMixPreviews();
  // Handle for the automated checks of the interface (not available in a production build).
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    (window as unknown as { __verticut?: unknown }).__verticut = { useEditor, usePlayback, player };
  }, []);
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

  // The player column hugs the vertical video; the two panels share what is left
  // unless the user has dragged a border (then that width is kept).
  const free = Math.max(MIN_TOOLS + MIN_SIDE + MIN_PLAYER, row.w - 2 * DIVIDER);
  const fitPlayer = Math.round(Math.max(120, row.h - PLAYER_CONTROLS - 2 * PLAYER_PADDING) * (9 / 16) + 2 * PLAYER_PADDING);
  let toolsW: number;
  let sideW = 0;
  let playerW = 0;
  if (layout.player === 'center') {
    const autoPlayer = clamp(fitPlayer, MIN_PLAYER, free - MIN_TOOLS - MIN_SIDE);
    toolsW = clamp(layout.toolsW ?? (free - autoPlayer) * 0.42, MIN_TOOLS, free - MIN_SIDE - MIN_PLAYER);
    sideW = clamp(layout.sideW ?? free - autoPlayer - toolsW, MIN_SIDE, free - toolsW - MIN_PLAYER);
  } else {
    playerW = clamp(layout.playerW ?? fitPlayer, MIN_PLAYER, free - MIN_TOOLS - MIN_SIDE);
    toolsW = clamp(layout.toolsW ?? (free - playerW) * 0.42, MIN_TOOLS, free - playerW - MIN_SIDE);
  }

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
      <TopBar
        onExport={() => setExportOpen(true)}
        onHelp={openHelp}
        onSave={saveNow}
        playerSide={layout.player}
        onPlayerSide={(player) => setLayout({ player })}
        onResetLayout={() => setLayout({ toolsW: null, sideW: null, playerW: null, timelineH: 300 })}
      />
      <div ref={rowRef} className="flex min-h-0 flex-1">
        <div className="shrink-0" style={{ width: toolsW }}>
          <ToolsPanel />
        </div>
        <Divider
          axis="x"
          start={() => toolsW}
          onChange={(v) => setLayout({ toolsW: clamp(v, MIN_TOOLS, free - MIN_SIDE - MIN_PLAYER) })}
          onReset={() => setLayout({ toolsW: null })}
        />
        {layout.player === 'center' ? (
          <>
            <div className="min-w-0 flex-1">
              <Preview />
            </div>
            <Divider
              axis="x"
              start={() => -sideW}
              onChange={(v) => setLayout({ sideW: clamp(-v, MIN_SIDE, free - toolsW - MIN_PLAYER) })}
              onReset={() => setLayout({ sideW: null })}
            />
            <div className="shrink-0" style={{ width: sideW }}>
              <InspectorPanel />
            </div>
          </>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <InspectorPanel />
            </div>
            <Divider
              axis="x"
              start={() => -playerW}
              onChange={(v) => setLayout({ playerW: clamp(-v, MIN_PLAYER, free - toolsW - MIN_SIDE) })}
              onReset={() => setLayout({ playerW: null })}
            />
            <div className="shrink-0" style={{ width: playerW }}>
              <Preview />
            </div>
          </>
        )}
      </div>
      <Divider
        axis="y"
        start={() => -layout.timelineH}
        onChange={(v) => setLayout({ timelineH: clamp(-v, MIN_TIMELINE, window.innerHeight - 260) })}
        onReset={() => setLayout({ timelineH: 300 })}
      />
      <Timeline height={layout.timelineH} />
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center border-4 border-dashed border-accent/70 bg-black/60">
          <p className="rounded-xl bg-panel px-6 py-4 text-lg font-semibold">Suelta los archivos para añadirlos al proyecto</p>
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
