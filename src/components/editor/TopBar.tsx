'use client';
import Link from 'next/link';
import { useRef } from 'react';
import { CircleHelp, Download, FileDown, FileUp, PanelRight, PanelsLeftRight, Redo2, RotateCcw, Undo2 } from 'lucide-react';
import clsx from 'clsx';
import type { ProjectDoc } from '@/lib/shared/types';
import { normalizeProjectDoc } from '@/lib/shared/types';
import { api } from '@/lib/client/api';
import { useEditor } from '@/lib/client/store';
import { Button, IconButton } from '@/components/ui';

function SaveState() {
  const state = useEditor((s) => s.saveState);
  const label = { idle: '', pending: 'Cambios sin guardar', saving: 'Guardando…', saved: 'Guardado', error: 'Error al guardar' }[state];
  return <span className={clsx('text-xs', state === 'error' ? 'text-danger' : 'text-faint')}>{label}</span>;
}

function TranscriberBadge() {
  const status = useEditor((s) => s.status);
  if (!status) return null;
  const label =
    status.transcriber === 'openai' ? 'Whisper API' : status.transcriber === 'whispercpp' ? 'Transcripción local' : 'Instalar transcripción';
  return (
    <button
      title={`${status.transcriberDetail} · clic para configurar`}
      onClick={() => useEditor.getState().set({ setupOpen: true })}
      onMouseUp={(e) => e.currentTarget.blur()}
      className={clsx(
        'hidden rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors lg:inline',
        status.transcriber === 'none'
          ? 'border-accent/60 bg-accent/10 text-accent hover:bg-accent/20'
          : 'border-line-strong text-muted hover:text-fg',
      )}
    >
      {label}
    </button>
  );
}

interface TopBarProps {
  onExport: () => void;
  onHelp: () => void;
  onSave: () => void;
  playerSide: 'center' | 'right';
  onPlayerSide: (side: 'center' | 'right') => void;
  onResetLayout: () => void;
}

export function TopBar({ onExport, onHelp, onSave, playerSide, onPlayerSide, onResetLayout }: TopBarProps) {
  const name = useEditor((s) => s.doc?.name ?? '');
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const fileRef = useRef<HTMLInputElement>(null);

  const downloadJson = () => {
    const doc = useEditor.getState().doc;
    if (!doc) return;
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${doc.name || 'proyecto'}.verticut.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (file: File) => {
    const s = useEditor.getState();
    try {
      const raw = JSON.parse(await file.text()) as ProjectDoc;
      if (!Array.isArray(raw.clips)) throw new Error('El archivo no es un proyecto de Verticut');
      const current = s.doc!;
      s.commitDoc(() => normalizeProjectDoc({ ...raw, id: current.id, createdAt: current.createdAt }));
      s.upsertMedia(await api.media(raw.media ?? []));
      const missing = (raw.media ?? []).filter((id) => !useEditor.getState().media[id]);
      s.toast(
        missing.length ? `Proyecto importado. Faltan ${missing.length} medios en este equipo.` : 'Proyecto importado',
        missing.length ? 'error' : 'success',
      );
    } catch (e) {
      s.toast(e instanceof Error ? e.message : 'JSON no válido', 'error');
    }
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
      <Link href="/" className="flex items-center gap-1.5 text-sm font-black tracking-tight" title="Proyectos">
        <span className="flex h-6 w-6 items-center justify-center rounded bg-accent text-xs text-black">V</span>
        <span className="hidden sm:inline">VERTICUT</span>
      </Link>
      <div className="h-5 w-px bg-line" />
      <input
        value={name}
        onChange={(e) => useEditor.getState().commit((d) => void (d.name = e.target.value), 'name')}
        className="w-56 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-medium hover:border-line focus:border-line-strong focus:bg-panel-2 focus:outline-none"
        aria-label="Nombre del proyecto"
      />
      <button onClick={onSave} className="hover:underline">
        <SaveState />
      </button>
      <TranscriberBadge />
      <div className="flex-1" />
      <IconButton label="Deshacer (Ctrl+Z)" disabled={!canUndo} onClick={() => useEditor.getState().undo()}>
        <Undo2 size={16} />
      </IconButton>
      <IconButton label="Rehacer (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => useEditor.getState().redo()}>
        <Redo2 size={16} />
      </IconButton>
      <div className="h-5 w-px bg-line" />
      <IconButton label="Reproductor en el centro" active={playerSide === 'center'} onClick={() => onPlayerSide('center')}>
        <PanelsLeftRight size={16} />
      </IconButton>
      <IconButton label="Reproductor a la derecha" active={playerSide === 'right'} onClick={() => onPlayerSide('right')}>
        <PanelRight size={16} />
      </IconButton>
      <IconButton label="Restablecer el tamaño de los paneles" onClick={onResetLayout}>
        <RotateCcw size={15} />
      </IconButton>
      <div className="h-5 w-px bg-line" />
      <IconButton label="Descargar proyecto (JSON)" onClick={downloadJson}>
        <FileDown size={16} />
      </IconButton>
      <IconButton label="Importar proyecto (JSON)" onClick={() => fileRef.current?.click()}>
        <FileUp size={16} />
      </IconButton>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importJson(f);
          e.target.value = '';
        }}
      />
      <IconButton label="Atajos de teclado (?)" onClick={onHelp}>
        <CircleHelp size={16} />
      </IconButton>
      <Button variant="primary" onClick={onExport}>
        <Download size={15} /> Exportar
      </Button>
    </header>
  );
}
