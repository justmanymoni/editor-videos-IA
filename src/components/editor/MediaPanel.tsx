'use client';
import { useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  AlertTriangle,
  AudioLines,
  Film,
  Image as ImageIcon,
  Loader2,
  Music,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import type { MediaInfo } from '@/lib/shared/types';
import { suggestBroll } from '@/lib/shared/suggest';
import { mediaUrl } from '@/lib/client/api';
import { useEditor } from '@/lib/client/store';
import { useClipWords } from '@/lib/client/derived';
import { usePlayback } from '@/lib/client/player';
import { formatBytes, formatTime } from '@/lib/client/format';
import {
  addAudio,
  addBroll,
  addClipInstance,
  refreshResources,
  removeMediaFromProject,
  retranscribe,
  uploadClips,
  uploadResources,
} from '@/lib/client/actions';
import { Button, IconButton, ProgressBar, Segmented } from '@/components/ui';
import { api } from '@/lib/client/api';

export const MEDIA_DRAG_TYPE = 'application/x-verticut-media';

type Tab = 'clips' | 'broll' | 'music';

export function MediaPanel() {
  const [tab, setTab] = useState<Tab>('clips');
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex border-b border-line px-2 pt-2">
        {(
          [
            ['clips', 'Clips', Film],
            ['broll', 'B-roll', ImageIcon],
            ['music', 'Música', Music],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            onMouseUp={(e) => e.currentTarget.blur()}
            className={clsx(
              'flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 pb-2 text-xs font-semibold transition-colors',
              tab === id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'clips' && <ClipsTab />}
        {tab === 'broll' && <ResourcesTab kind="broll" />}
        {tab === 'music' && <ResourcesTab kind="music" />}
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

function TranscriptStatus({ media }: { media: MediaInfo }) {
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
function AudioControls({ media }: { media: MediaInfo }) {
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
        <Button
          size="sm"
          variant="ghost"
          className="self-start px-1.5"
          onClick={start}
          title="Separa la voz de la música de fondo para quitar una de las dos"
        >
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
    <div className="mt-1 flex flex-col gap-1.5 rounded-md border border-line bg-panel p-2">
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
      {(
        [
          ['Voz', voice, (v: number) => setMix(media.id, v, music, `mix-v:${media.id}`)],
          ['Música', music, (v: number) => setMix(media.id, voice, v, `mix-m:${media.id}`)],
        ] as const
      ).map(([label, value, set]) => (
        <label key={label} className="flex items-center gap-2 text-[11px] text-muted">
          <span className="w-10">{label}</span>
          <input type="range" min={0} max={1} step={0.05} value={value} onChange={(e) => set(Number(e.target.value))} className="min-w-0 flex-1" />
          <span className="w-8 text-right tabular-nums">{Math.round(value * 100)}%</span>
        </label>
      ))}
      {preparing && (
        <span className="flex items-center gap-1 text-[11px] text-faint">
          <Loader2 size={11} className="animate-spin" /> Preparando la mezcla para la vista previa…
        </span>
      )}
    </div>
  );
}

function ClipsTab() {
  const doc = useEditor((s) => s.doc)!;
  const media = useEditor((s) => s.media);
  const clips = doc.media.map((id) => media[id]).filter((m): m is MediaInfo => !!m && m.role === 'clip');
  const onTimeline = new Set(doc.clips.map((c) => c.mediaId));

  return (
    <div className="flex flex-col gap-3 p-3">
      <DropZone
        accept="video/*,.mov,.mp4,.m4v,.mkv,.webm"
        label="Arrastra tus clips aquí (mp4, mov) o haz clic para elegirlos"
        onFiles={uploadClips}
      />
      <Uploads />
      {clips.map((m, i) => (
        <div key={m.id} className="group flex gap-2.5 rounded-lg border border-line bg-panel-2 p-2">
          <Thumb media={m} className="h-[72px] w-[54px]" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-start justify-between gap-1">
              <p className="truncate text-xs font-medium" title={m.name}>
                {i + 1}. {m.name}
              </p>
              <div className="-mt-1 -mr-1 flex opacity-0 transition-opacity group-hover:opacity-100">
                <IconButton label="Volver a transcribir" className="h-6 w-6" onClick={() => void retranscribe(m.id)} disabled={!m.hasAudio}>
                  <RefreshCw size={12} />
                </IconButton>
                <IconButton
                  label="Quitar del proyecto"
                  className="h-6 w-6"
                  onClick={() => confirm(`¿Quitar "${m.name}" del proyecto?`) && removeMediaFromProject(m.id)}
                >
                  <Trash2 size={12} />
                </IconButton>
              </div>
            </div>
            <p className="text-[11px] text-muted tabular-nums">
              {formatTime(m.duration, false)} · {m.width}×{m.height} · {formatBytes(m.size)}
            </p>
            <MediaStatus media={m} />
            <TranscriptStatus media={m} />
            {m.hasAudio && m.status !== 'error' && <AudioControls media={m} />}
            {!onTimeline.has(m.id) && m.status !== 'error' && (
              <Button size="sm" variant="ghost" className="self-start px-1.5" onClick={() => addClipInstance(m)}>
                <Plus size={12} /> Añadir a la línea de tiempo
              </Button>
            )}
          </div>
        </div>
      ))}
      {!clips.length && (
        <p className="px-2 text-center text-xs leading-relaxed text-faint">
          Sube varios clips a la vez: se colocan en orden en la línea de tiempo y se transcriben automáticamente.
        </p>
      )}
    </div>
  );
}

function ResourcesTab({ kind }: { kind: 'broll' | 'music' }) {
  const dir = useEditor((s) => s.resourcesDir);
  const ids = useEditor((s) => s.resourceIds);
  const media = useEditor((s) => s.media);
  const [refreshing, setRefreshing] = useState(false);
  const list = ids.map((id) => media[id]).filter((m): m is MediaInfo => !!m && (kind === 'music' ? m.kind === 'audio' : m.kind !== 'audio'));

  const refresh = async () => {
    setRefreshing(true);
    await refreshResources();
    setRefreshing(false);
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint" title={dir}>
          {dir || 'recursos/'}
        </p>
        <IconButton label="Volver a leer la carpeta" className="h-7 w-7" onClick={refresh}>
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
        </IconButton>
      </div>
      <DropZone
        accept={kind === 'music' ? 'audio/*' : 'video/*,image/*,.mov'}
        label={kind === 'music' ? 'Añade música (mp3, wav, m4a) a la carpeta de recursos' : 'Añade clips o imágenes a la carpeta de recursos'}
        onFiles={uploadResources}
      />
      <Uploads />
      {kind === 'broll' && <Suggestions />}
      <p className="text-[11px] text-faint">
        {kind === 'music' ? 'Arrastra a la pista de audio o pulsa +.' : 'Arrastra a la pista de B-roll o pulsa + para añadir en el cursor.'}
      </p>
      <div className={clsx(kind === 'broll' ? 'grid grid-cols-2 gap-2' : 'flex flex-col gap-2')}>
        {list.map((m) => (kind === 'music' ? <MusicItem key={m.id} media={m} /> : <BrollCard key={m.id} media={m} />))}
      </div>
      {!list.length && (
        <p className="text-center text-xs text-faint">La carpeta está vacía. Copia archivos en ella y pulsa recargar, o súbelos aquí.</p>
      )}
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

function BrollCard({ media }: { media: MediaInfo }) {
  return (
    <div
      {...dragProps(media)}
      className="group relative cursor-grab overflow-hidden rounded-md border border-line bg-panel-2 active:cursor-grabbing"
      title={media.name}
    >
      <Thumb media={media} className="aspect-[9/12] w-full rounded-none" />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-1.5 pt-4 pb-1">
        <p className="truncate text-[11px] font-medium">{media.name}</p>
        <p className="text-[10px] text-muted">{media.kind === 'image' ? 'Imagen' : formatTime(media.duration, false)}</p>
      </div>
      {media.status === 'processing' && <ProgressBar className="absolute inset-x-1 top-1" value={media.progress} indeterminate />}
      <button
        onClick={() => addBroll(media, usePlayback.getState().time)}
        className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded bg-accent text-black opacity-0 transition-opacity group-hover:opacity-100"
        title="Añadir en el cursor"
      >
        <Plus size={14} />
      </button>
    </div>
  );
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
