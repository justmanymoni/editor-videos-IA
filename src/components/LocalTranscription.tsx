'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Cpu, Download, Loader2 } from 'lucide-react';
import type { JobInfo, ServerStatus } from '@/lib/shared/types';
import { DEFAULT_WHISPER_MODEL, WHISPER_MODELS } from '@/lib/shared/whisper-models';
import { api } from '@/lib/client/api';
import { Button, ProgressBar } from '@/components/ui';

/**
 * Installs offline transcription (whisper.cpp + a speech model) with one
 * click. Once installed, subtitles are generated on this computer: no API
 * key, no cost, no internet needed.
 */
export function LocalTranscription({ status, onInstalled }: { status: ServerStatus | null; onInstalled: (status: ServerStatus) => void }) {
  const [model, setModel] = useState(DEFAULT_WHISPER_MODEL);
  const [job, setJob] = useState<JobInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const follow = useCallback(
    (id: string) => {
      if (timer.current) clearInterval(timer.current);
      timer.current = setInterval(async () => {
        try {
          const next = await api.job(id);
          setJob(next);
          if (next.status === 'running' || next.status === 'queued') return;
          if (timer.current) clearInterval(timer.current);
          if (next.status === 'done') {
            setChanging(false);
            onInstalled(await api.status());
          } else setError(next.error ?? 'La instalación no terminó');
        } catch (e) {
          if (timer.current) clearInterval(timer.current);
          setError(e instanceof Error ? e.message : String(e));
        }
      }, 700);
    },
    [onInstalled],
  );

  // Resume the progress bar if an installation is already running.
  useEffect(() => {
    const id = status?.local.setupJobId;
    if (id && !job) follow(id);
  }, [status?.local.setupJobId, job, follow]);

  useEffect(() => () => void (timer.current && clearInterval(timer.current)), []);

  if (!status) return null;
  const running = job?.status === 'running' || job?.status === 'queued';
  const installed = !!status.local.binary && !!status.local.model;
  const selected = WHISPER_MODELS.find((m) => m.id === model)!;

  const install = async () => {
    setError(null);
    try {
      const j = await api.installWhisper(model);
      setJob(j);
      follow(j.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4 text-sm">
      <div className="flex items-start gap-3">
        <Cpu size={18} className="mt-0.5 shrink-0 text-accent" />
        <div className="flex-1">
          <p className="font-semibold">Transcripción local</p>
          <p className="text-xs text-muted">
            Reconoce la voz en tu ordenador para crear los subtítulos. Gratis, sin API y sin internet una vez instalada.
          </p>
        </div>
        {installed && !running && <CheckCircle2 size={18} className="shrink-0 text-accent" />}
      </div>

      {installed && !running && !changing && (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted">
            Instalada · modelo <span className="text-fg">{status.local.model}</span>
            {status.transcriber === 'openai' && ' (ahora se usa OpenAI porque TRANSCRIBER=openai)'}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setChanging(true)}>
            Cambiar modelo
          </Button>
        </div>
      )}

      {(!installed || changing) && !running && (
        <>
          {!status.local.canInstall && (
            <p className="flex gap-2 rounded-md border border-cut-filler/40 bg-cut-filler/5 p-2.5 text-xs text-fg">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-cut-filler" />
              {status.local.platform === 'darwin' ? (
                <span>
                  En Mac instala primero el motor con <code className="text-accent">brew install whisper-cpp</code> y luego pulsa Instalar para
                  descargar el modelo.
                </span>
              ) : (
                <span>No hay motor precompilado para este sistema. Compila whisper.cpp e indica su ruta en WHISPER_CPP_BIN (ver README).</span>
              )}
            </p>
          )}
          <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Modelo de transcripción">
            {WHISPER_MODELS.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={model === m.id}
                onClick={() => setModel(m.id)}
                className={clsx(
                  'flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                  model === m.id ? 'border-accent bg-accent/10' : 'border-line-strong hover:border-faint',
                )}
              >
                <span className={clsx('h-3.5 w-3.5 shrink-0 rounded-full border-2', model === m.id ? 'border-accent bg-accent' : 'border-faint')} />
                <span className="flex-1">
                  <span className="font-medium">{m.label}</span> <span className="text-xs text-faint">· {m.sizeMB} MB</span>
                  <span className="block text-xs text-muted">{m.description}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="primary" onClick={install}>
              <Download size={14} /> {installed ? 'Usar este modelo' : 'Instalar'} (descarga única de {selected.sizeMB} MB)
            </Button>
            {changing && (
              <Button variant="ghost" onClick={() => setChanging(false)}>
                Cancelar
              </Button>
            )}
          </div>
        </>
      )}

      {running && job && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5">
              <Loader2 size={13} className="animate-spin text-accent" /> {job.message ?? 'Preparando…'}
            </span>
            <span className="tabular-nums">{Math.round(job.progress * 100)}%</span>
          </div>
          <ProgressBar value={job.progress} indeterminate={job.progress <= 0} />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-faint">Puedes seguir usando la app. Los clips se transcribirán solos al terminar.</p>
            <Button size="sm" variant="ghost" onClick={() => api.cancelJob(job.id)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-xs whitespace-pre-line text-danger">{error}</p>}
    </div>
  );
}
