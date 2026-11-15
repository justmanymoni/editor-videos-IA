'use client';
import { useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  AlertTriangle,
  AudioLines,
  FileText,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Layers,
  LayoutTemplate,
  Loader2,
  Mic,
  Music,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  Type,
  Upload,
} from 'lucide-react';
import type { MediaInfo } from '@/lib/shared/types';
import { suggestBroll } from '@/lib/shared/suggest';
import { api, mediaUrl } from '@/lib/client/api';
import { useEditor, type ToolsTab } from '@/lib/client/store';
import { useClipWords } from '@/lib/client/derived';
import { usePlayback } from '@/lib/client/player';
import { useRecorder } from '@/lib/client/recorder';
import { formatBytes, formatTime } from '@/lib/client/format';
import {
  addAudio,
  addBroll,
  addToTimeline,
  addVoiceRecording,
  refreshResources,
  removeMediaFromProject,
  retranscribe,
  uploadClips,
  uploadResources,
} from '@/lib/client/actions';
import { Button, IconButton, ProgressBar, Segmented, SliderRow } from '@/components/ui';
import { TextTab } from './TextTab';
import { TemplatesTab } from './TemplatesTab';
import { TranscriptPanel } from './TranscriptPanel';

export const MEDIA_DRAG_TYPE = 'application/x-verticut-media';

const TABS: [ToolsTab, string, typeof Film][] = [
  ['media', 'Multimedia', Film],
  ['audio', 'Audio', Music],
  ['text', 'Texto', Type],
  ['templates', 'Plantillas', LayoutTemplate],
  ['transcript', 'Transcripción', FileText],
];

/** Left panel, CapCut style: tool tabs on top, their content below. */
export function ToolsPanel() {
  const tab = useEditor((s) => s.toolsTab);
  return (
    <aside className="flex h-full min-w-0 flex-col bg-panel">
      <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-line px-2 py-1.5">
        {TABS.map(([id, label, Icon]) => (
          <button
            key={id}
            data-tool-tab={id}
            onClick={() => useEditor.getState().set({ toolsTab: id })}
            onMouseUp={(e) => e.currentTarget.blur()}
            className={clsx(
              'flex min-w-14 shrink-0 flex-col items-center gap-0.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors',
              tab === id ? 'text-accent' : 'text-muted hover:bg-panel-3 hover:text-fg',
            )}
          >
            <Icon size={17} /> {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'media' && <MediaTab />}
        {tab === 'audio' && <AudioTab />}
        {tab === 'text' && <TextTab />}
        {tab === 'templates' && <TemplatesTab />}
        {tab === 'transcript' && <TranscriptPanel />}
      </div>
    </aside>
  );
}

function DropZone({ accept, label, onFiles }: { accept: string; label: string; onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        onFiles([...e.dataTransfer.files]);
      }}
      className={clsx(
        'flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed px-3 py-4 text-center text-xs transition-colors',
        over ? 'border-accent bg-accent/10 text-fg' : 'border-line-strong text-muted hover:border-faint hover:text-fg',
      )}
    >
      <Upload size={18} />
      <span>{label}</span>
      <input
        ref={input}
        type="file"
        multiple
        accept={accept}
        hidden
        onChange={(e) => (onFiles([...(e.target.files ?? [])]), (e.target.value = ''))}
      />
    </div>
  );
}

function Uploads() {
  const uploads = useEditor((s) => s.uploads);
  if (!uploads.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {uploads.map((u) => (
        <div key={u.id} className="rounded-md border border-line bg-panel-2 px-3 py-2">
          <div className="mb-1.5 flex justify-between gap-2 text-xs">
            <span className="truncate">{u.name}</span>
            <span className="text-muted tabular-nums">{Math.round(u.progress * 100)}%</span>
          </div>
          <ProgressBar value={u.progress} />
        </div>
      ))}
    </div>
  );
}

function Thumb({ media, className }: { media: MediaInfo; className?: string }) {
  const src = mediaUrl.thumb(media);
  const Icon = media.kind === 'audio' ? Music : media.kind === 'image' ? ImageIcon : Film;
  return (
    <div className={clsx('relative flex shrink-0 items-center justify-center overflow-hidden rounded bg-panel-3 text-faint', className)}>
      {src ? <img src={src} alt="" className="h-full w-full object-cover" draggable={false} /> : <Icon size={16} />}
    </div>
  );
}

function MediaStatus({ media }: { media: MediaInfo }) {
  if (media.status === 'error')
    return (
      <p className="flex items-center gap-1 text-[11px] text-danger" title={media.error ?? ''}>
        <AlertTriangle size={11} /> {media.error?.split('\n')[0] ?? 'Error'}
      </p>
    );
  if (media.status === 'processing')
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-muted">{media.stage ?? 'Procesando'}…</span>
        <ProgressBar value={media.progress} indeterminate={media.progress <= 0} />
      </div>
    );
  return null;
}

export function TranscriptStatus({ media }: { media: MediaInfo }) {
  const t = media.transcript;
  if (!media.hasAudio) return <span className="text-[11px] text-faint">Sin audio</span>;
  if (t.status === 'running' || t.status === 'queued')
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-muted">
          {t.status === 'queued' ? 'Transcripción en cola…' : `Transcribiendo… ${Math.round(t.progress * 100)}%`}
        </span>
        <ProgressBar value={t.progress} indeterminate={t.status === 'queued' || t.progress <= 0.02} />
      </div>
    );
  if (t.status === 'error')
    return (
      <div className="flex items-start gap-1 text-[11px] text-danger">
        <AlertTriangle size={11} className="mt-0.5 shrink-0" />
        <span className="line-clamp-2" title={t.error ?? ''}>
          {t.error}
        </span>
      </div>
    );
  if (t.status === 'done') return <span className="text-[11px] text-faint">Transcrito · {t.language}</span>;
  return null;
}

function setMix(mediaId: string, voice: number, music: number, coalesce?: string) {
  useEditor.getState().commit((d) => {
    if (voice === 1 && music === 1) delete d.audioMix[mediaId];
    else d.audioMix[mediaId] = { voice, music };
  }, coalesce);
}

/** Separate the clip's voice from its background music and choose what to keep. */
export function AudioControls({ media }: { media: MediaInfo }) {
  const mix = useEditor((s) => s.doc?.audioMix[media.id]);
  const mixUrl = useEditor((s) => s.mixUrls[media.id]);
  const sep = media.separation ?? { status: 'none', progress: 0, message: null, error: null };
  const start = async () => {
    try {
      useEditor.getState().upsertMedia([await api.separate(media.id)]);
    } catch (e) {
      useEditor.getState().toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  if (sep.status === 'none' || sep.status === 'error') {
    return (
      <div className="flex flex-col gap-1">
        <Button size="sm" className="self-start" onClick={start} title="Separa la voz de la música de fondo para quitar una de las dos">
          <AudioLines size={12} /> Separar voz y música
        </Button>
        {sep.status === 'error' && <p className="line-clamp-3 text-[11px] whitespace-pre-line text-danger">{sep.error}</p>}
      </div>
    );
  }
  if (sep.status === 'queued' || sep.status === 'running') {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-muted">
          {sep.message ?? 'Separando voz y música…'} {sep.status === 'running' && `${Math.round(sep.progress * 100)}%`}
        </span>
        <ProgressBar value={sep.progress} indeterminate={sep.status === 'queued' || sep.progress <= 0} />
      </div>
    );
  }
  const voice = mix?.voice ?? 1;
  const music = mix?.music ?? 1;
  const preset = !mix ? 'original' : voice > 0 && music === 0 ? 'voice' : voice === 0 && music > 0 ? 'music' : 'custom';
  const preparing = !!mix && !mixUrl?.endsWith(`v=${voice}&m=${music}`);
  return (
    <div className="flex flex-col gap-1.5">
      <Segmented
        value={preset}
        onChange={(v) =>
          v === 'original' ? setMix(media.id, 1, 1) : v === 'voice' ? setMix(media.id, 1, 0) : v === 'music' ? setMix(media.id, 0, 1) : undefined
        }
        options={[
          { value: 'original', label: 'Original' },
          { value: 'voice', label: 'Sin música' },
          { value: 'music', label: 'Sin voz' },
        ]}
      />
      <SliderRow
        label="Voz"
        value={voice}
        min={0}
        max={1}
        step={0.05}
        scale={100}
        unit="%"
        onChange={(v) => setMix(media.id, v, music, `mix-v:${media.id}`)}
      />
      <SliderRow
        label="Música"
        value={music}
        min={0}
        max={1}
        step={0.05}
        scale={100}
        unit="%"
        onChange={(v) => setMix(media.id, voice, v, `mix-m:${media.id}`)}
      />
      {preparing && (
        <span className="flex items-center gap-1 text-[11px] text-faint">
          <Loader2 size={11} className="animate-spin" /> Preparando la mezcla para la vista previa…
        </span>
      )}
    </div>
  );
}

/** Videos and photos: the project's own files and the resources folder. */
function MediaTab() {
  const doc = useEditor((s) => s.doc)!;
  const media = useEditor((s) => s.media);
  const dir = useEditor((s) => s.resourcesDir);
  const resourceIds = useEditor((s) => s.resourceIds);
  const [refreshing, setRefreshing] = useState(false);
  const own = doc.media.map((id) => media[id]).filter((m): m is MediaInfo => !!m && m.kind !== 'audio' && !m.external);
  const resources = resourceIds.map((id) => media[id]).filter((m): m is MediaInfo => !!m && m.kind !== 'audio');
  const used = new Set([...doc.clips.map((c) => c.mediaId), ...doc.broll.map((b) => b.mediaId)]);

  const refresh = async () => {
    setRefreshing(true);
    await refreshResources();
    setRefreshing(false);
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <DropZone accept="video/*,image/*,audio/*,.mov" label="Importar vídeos, fotos o audio (arrástralos aquí o haz clic)" onFiles={uploadClips} />
      <Uploads />
      {own.map((m) => (
        <div
          key={m.id}
          {...dragProps(m)}
          className="group flex cursor-grab gap-2.5 rounded-lg border border-line bg-panel-2 p-2 active:cursor-grabbing"
        >
          <div className="relative shrink-0">
            <Thumb media={m} className="h-[72px] w-[54px]" />
            {used.has(m.id) && <span className="absolute top-0.5 left-0.5 rounded bg-black/75 px-1 text-[9px] font-medium text-accent">Añadido</span>}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-start justify-between gap-1">
              <p className="truncate text-xs font-medium" title={m.name}>
                {m.name}
              </p>
              <div className="-mt-1 -mr-1 flex shrink-0">
                <IconButton
                  label="Añadir a la línea de tiempo"
                  className="h-6 w-6 text-accent"
                  onClick={() => addToTimeline(m)}
                  disabled={m.status === 'error'}
                >
                  <Plus size={14} />
                </IconButton>
                {m.kind === 'video' && (
                  <IconButton
                    label="Volver a transcribir"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100"
                    onClick={() => void retranscribe(m.id)}
                    disabled={!m.hasAudio}
                  >
                    <RefreshCw size={12} />
                  </IconButton>
                )}
                <IconButton
                  label="Quitar del proyecto"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100"
                  onClick={() => confirm(`¿Quitar "${m.name}" del proyecto?`) && removeMediaFromProject(m.id)}
                >
                  <Trash2 size={12} />
                </IconButton>
              </div>
            </div>
            <p className="text-[11px] text-muted tabular-nums">
              {m.kind === 'image' ? 'Foto' : formatTime(m.duration, false)} · {m.width}×{m.height} · {formatBytes(m.size)}
            </p>
            <MediaStatus media={m} />
            {m.kind === 'video' && <TranscriptStatus media={m} />}
            {m.kind === 'video' && m.hasAudio && m.status !== 'error' && (
              <button
                className="flex items-center gap-1 self-start text-[11px] text-muted hover:text-accent"
                onClick={() => useEditor.getState().set({ inspectorTab: 'audio' })}
                title="Los ajustes de voz y música están en la pestaña Audio, a la derecha"
              >
                <AudioLines size={11} /> Voz y música
              </button>
            )}
          </div>
        </div>
      ))}
      {!own.length && (
        <p className="px-2 text-center text-xs leading-relaxed text-faint">
          Los vídeos que importes se colocan en la línea de tiempo y se transcriben solos. Con + añades otra copia; también puedes arrastrarlos a la
          pista que quieras.
        </p>
      )}

      <div className="mt-1 flex items-center gap-2 border-t border-line pt-3">
        <FolderOpen size={13} className="shrink-0 text-faint" />
        <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint" title={dir}>
          {dir || 'recursos/'}
        </p>
        <IconButton label="Volver a leer la carpeta de recursos" className="h-7 w-7" onClick={refresh}>
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
        </IconButton>
      </div>
      <Suggestions />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
        {resources.map((m) => (
          <ResourceCard key={m.id} media={m} added={used.has(m.id)} />
        ))}
      </div>
      {!resources.length && <p className="text-center text-[11px] text-faint">Copia vídeos o fotos en esa carpeta para tenerlos siempre a mano.</p>}
    </div>
  );
}

function ResourceCard({ media, added }: { media: MediaInfo; added: boolean }) {
  return (
    <div
      {...dragProps(media)}
      className="group relative cursor-grab overflow-hidden rounded-md border border-line bg-panel-2 active:cursor-grabbing"
      title={media.name}
    >
      <Thumb media={media} className="aspect-[9/12] w-full rounded-none" />
      {added && <span className="absolute top-1 left-1 rounded bg-black/75 px-1 text-[9px] font-medium text-accent">Añadido</span>}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-1.5 pt-4 pb-1">
        <p className="truncate text-[11px] font-medium">{media.name}</p>
        <p className="text-[10px] text-muted">{media.kind === 'image' ? 'Foto' : formatTime(media.duration, false)}</p>
      </div>
      {media.status === 'processing' && <ProgressBar className="absolute inset-x-1 top-1" value={media.progress} indeterminate />}
      <div className="absolute top-1 right-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={() => addBroll(media, usePlayback.getState().time)}
          className="flex h-6 w-6 items-center justify-center rounded bg-panel-3 text-fg hover:bg-line-strong"
          title="Superponer en el cursor (B-roll)"
        >
          <Layers size={13} />
        </button>
        <button
          onClick={() => addToTimeline(media)}
          className="flex h-6 w-6 items-center justify-center rounded bg-accent text-black"
          title="Añadir a la pista principal"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

/** Music and sounds, plus recording your own voice. */
function AudioTab() {
  const ids = useEditor((s) => s.resourceIds);
  const media = useEditor((s) => s.media);
  const list = ids.map((id) => media[id]).filter((m): m is MediaInfo => !!m && m.kind === 'audio');
  const recorder = useRecorder();
  const [saving, setSaving] = useState(false);

  const toggleRecording = async () => {
    if (!recorder.recording) return void recorder.start();
    setSaving(true);
    const audio = await recorder.stop();
    if (audio) await addVoiceRecording(audio);
    setSaving(false);
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <Button variant={recorder.recording ? 'danger' : 'secondary'} className="h-8" onClick={toggleRecording} disabled={saving}>
        {saving ? (
          <>
            <Loader2 size={15} className="animate-spin" /> Guardando…
          </>
        ) : recorder.recording ? (
          <>
            <Square size={13} fill="currentColor" /> Parar y añadir ({formatTime(recorder.seconds, false)})
          </>
        ) : (
          <>
            <Mic size={14} className="text-accent" /> Grabar mi voz
          </>
        )}
      </Button>
      <p className="-mt-1 text-[11px] text-faint">La grabación empieza donde está el cursor y se añade a la pista de audio.</p>
      <DropZone accept="audio/*" label="Importar música o sonidos (mp3, wav, m4a)" onFiles={uploadResources} />
      <Uploads />
      <div className="flex flex-col gap-2">
        {list.map((m) => (
          <MusicItem key={m.id} media={m} />
        ))}
      </div>
      {!list.length && <p className="text-center text-xs text-faint">Aún no hay audio. Importa música o graba tu voz.</p>}
    </div>
  );
}

function dragProps(media: MediaInfo) {
  return {
    draggable: media.status !== 'error',
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(MEDIA_DRAG_TYPE, media.id);
      e.dataTransfer.effectAllowed = 'copy';
    },
  };
}

function MusicItem({ media }: { media: MediaInfo }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  return (
    <div {...dragProps(media)} className="flex cursor-grab items-center gap-2 rounded-md border border-line bg-panel-2 p-2 active:cursor-grabbing">
      <IconButton
        label={playing ? 'Pausar' : 'Escuchar'}
        className="h-7 w-7"
        onClick={() => {
          const el = audio.current;
          if (!el) return;
          if (el.paused) void el.play();
          else el.pause();
        }}
      >
        {playing ? <Pause size={13} /> : <Play size={13} />}
      </IconButton>
      <audio ref={audio} src={`/api/media/${media.id}/file`} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{media.name}</p>
        <p className="text-[11px] text-muted">{formatTime(media.duration, false)}</p>
      </div>
      <IconButton label="Añadir en el cursor" className="h-7 w-7" onClick={() => addAudio(media, usePlayback.getState().time)}>
        <Plus size={14} />
      </IconButton>
    </div>
  );
}

function Suggestions() {
  const clipWords = useClipWords();
  const ids = useEditor((s) => s.resourceIds);
  const media = useEditor((s) => s.media);
  const broll = useEditor((s) => s.doc?.broll ?? []);
  const resources = useMemo(() => ids.map((id) => media[id]).filter(Boolean), [ids, media]);
  const suggestions = useMemo(() => suggestBroll(clipWords, resources), [clipWords, resources]);
  const free = suggestions.filter((s) => !broll.some((b) => b.start < s.end && b.start + b.duration > s.start));
  if (!suggestions.length) return null;
  return (
    <div className="rounded-lg border border-accent/25 bg-accent/5 p-2.5">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-accent">
        <Sparkles size={13} /> Sugerencias según la transcripción
      </p>
      <ul className="flex flex-col gap-1.5">
        {free.slice(0, 8).map((s) => {
          const m = media[s.mediaId];
          return (
            <li key={s.id} className="flex items-center gap-2 text-[11px]">
              <div className="min-w-0 flex-1">
                <p className="truncate text-fg" title={s.text}>
                  «{s.text}»
                </p>
                <p className="truncate text-muted">
                  {m?.name} · <span className="text-accent/80">{s.keywords.join(', ')}</span>
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5"
                onClick={() => m && addBroll(m, s.start, Math.max(1, Math.min(s.end - s.start + 0.3, m.kind === 'image' ? 4 : m.duration)))}
              >
                <Plus size={12} /> Añadir
              </Button>
            </li>
          );
        })}
        {!free.length && <li className="text-[11px] text-muted">Todas las sugerencias ya tienen B-roll.</li>}
      </ul>
    </div>
  );
}
