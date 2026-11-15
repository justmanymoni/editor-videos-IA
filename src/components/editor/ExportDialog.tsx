'use client';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Loader2 } from 'lucide-react';
import type { JobInfo } from '@/lib/shared/types';
import { api } from '@/lib/client/api';
import { useEditor } from '@/lib/client/store';
import { useSegments, useSubtitlePages } from '@/lib/client/derived';
import { formatBytes, formatTime } from '@/lib/client/format';
import { rasterizeTexts } from '@/lib/client/text-render';
import { sequenceDuration } from '@/lib/shared/timeline';
import { Button, Modal, ProgressBar, Segmented } from '@/components/ui';

type Quality = 'fast' | 'normal' | 'high';
type ExportFile = { name: string; url: string; size: number; createdAt: string };

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const doc = useEditor((s) => s.doc)!;
  const media = useEditor((s) => s.media);
  const segs = useSegments();
  const pages = useSubtitlePages();
  const [quality, setQuality] = useState<Quality>('normal');
  const [job, setJob] = useState<JobInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ExportFile[]>([]);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (open)
      api
        .exports()
        .then(setHistory)
        .catch(() => undefined);
  }, [open, job?.status]);

  useEffect(() => () => void (poll.current && clearInterval(poll.current)), []);

  const running = job?.status === 'queued' || job?.status === 'running';
  const duration = sequenceDuration(segs);
  const pendingTranscripts = doc.clips.filter((c) => {
    const st = media[c.mediaId]?.transcript.status;
    return st === 'queued' || st === 'running';
  }).length;

  const start = async () => {
    setError(null);
    try {
      // Manual texts are drawn here, exactly as in the preview, and sent as images.
      const j = await api.startExport(doc, quality, await rasterizeTexts(doc.texts));
      setJob(j);
      poll.current = setInterval(async () => {
        try {
          const next = await api.job(j.id);
          setJob(next);
          if (next.status !== 'queued' && next.status !== 'running' && poll.current) clearInterval(poll.current);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          if (poll.current) clearInterval(poll.current);
        }
      }, 500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const cancel = () => {
    if (!job) return;
    // The dialog goes back at once; the server stops FFmpeg in the background.
    if (poll.current) clearInterval(poll.current);
    void api.cancelJob(job.id).catch(() => undefined);
    setJob({ ...job, status: 'cancelled' });
  };

  const result = job?.status === 'done' ? (job.result as { url: string; name: string; size: number } | null) : null;

  return (
    <Modal open={open} onClose={onClose} title="Exportar vídeo" width="max-w-xl">
      <div className="flex flex-col gap-4 text-sm">
        <dl className="grid grid-cols-4 gap-2 rounded-lg border border-line bg-panel-2 p-3 text-center">
          {[
            ['Formato', 'MP4 H.264'],
            ['Resolución', '1080×1920'],
            ['Fotogramas', '30 fps'],
            ['Duración', formatTime(duration)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] text-faint">{k}</dt>
              <dd className="font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        <ul className="flex flex-col gap-1 text-xs text-muted">
          <li>
            {segs.length} fragmentos de {doc.clips.length} clips · {doc.broll.length} superposiciones · {doc.texts.length} textos · {doc.audio.length}{' '}
            audios
          </li>
          <li>{doc.subtitles.enabled ? `${pages.length} bloques de subtítulos incrustados` : 'Sin subtítulos'}</li>
          {pendingTranscripts > 0 && (
            <li className="flex items-center gap-1 text-cut-filler">
              <AlertTriangle size={12} /> {pendingTranscripts} clips se están transcribiendo: sus subtítulos aún no saldrán.
            </li>
          )}
        </ul>

        <div className="flex items-center gap-3">
          <span className="text-xs text-muted">Calidad</span>
          <div className="flex-1">
            <Segmented
              value={quality}
              onChange={setQuality}
              options={[
                { value: 'fast', label: 'Rápida' },
                { value: 'normal', label: 'Normal' },
                { value: 'high', label: 'Alta' },
              ]}
            />
          </div>
        </div>

        {job && (running || job.status === 'error' || job.status === 'cancelled') && (
          <div className="flex flex-col gap-2 rounded-lg border border-line bg-panel-2 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5">
                {running && <Loader2 size={13} className="animate-spin text-accent" />}
                {job.status === 'queued'
                  ? 'En cola…'
                  : job.status === 'cancelled'
                    ? 'Cancelado'
                    : job.status === 'error'
                      ? 'Error'
                      : (job.message ?? 'Renderizando')}
              </span>
              <span className="tabular-nums">{Math.round(job.progress * 100)}%</span>
            </div>
            <ProgressBar value={job.progress} indeterminate={job.status === 'queued'} />
            {job.error && job.status === 'error' && (
              <pre className="max-h-32 overflow-auto text-[11px] whitespace-pre-wrap text-danger">{job.error}</pre>
            )}
          </div>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}

        {result && (
          <div className="flex gap-4 rounded-lg border border-accent/30 bg-accent/5 p-3">
            <video src={result.url} controls className="h-48 rounded bg-black" style={{ aspectRatio: '9 / 16' }} />
            <div className="flex flex-col justify-center gap-2">
              <p className="flex items-center gap-1.5 font-semibold">
                <CheckCircle2 size={16} className="text-accent" /> Vídeo listo
              </p>
              <p className="text-xs break-all text-muted">
                {result.name} · {formatBytes(result.size)}
              </p>
              <a
                href={`${result.url}?download=1`}
                className="inline-flex h-8 items-center gap-1.5 self-start rounded-md bg-accent px-3 text-sm font-medium text-black hover:bg-accent-strong"
              >
                <Download size={14} /> Descargar MP4
              </a>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          {running ? (
            <Button variant="danger" onClick={cancel}>
              Cancelar
            </Button>
          ) : (
            <Button variant="primary" onClick={start} disabled={!segs.length}>
              <Download size={14} /> {result ? 'Exportar de nuevo' : 'Exportar MP4'}
            </Button>
          )}
        </div>

        {history.length > 0 && (
          <div className="border-t border-line pt-3">
            <p className="mb-2 text-xs font-medium text-muted">Exportaciones anteriores</p>
            <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto text-xs">
              {history.map((h) => (
                <li key={h.name} className="flex items-center justify-between gap-2">
                  <a href={h.url} target="_blank" rel="noreferrer" className="truncate text-fg hover:text-accent">
                    {h.name}
                  </a>
                  <span className="shrink-0 text-faint">{formatBytes(h.size)}</span>
                  <a href={`${h.url}?download=1`} className="shrink-0 text-muted hover:text-accent" title="Descargar">
                    <Download size={13} />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
