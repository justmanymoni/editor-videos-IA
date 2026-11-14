'use client';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  AlertTriangle,
  Captions,
  Copy,
  Download,
  EyeOff,
  FileText,
  Pilcrow,
  Play,
  RefreshCw,
  RotateCcw,
  Scissors,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import type { CutReason, Range } from '@/lib/shared/types';
import { keptRanges, type ClipWords, type WordView } from '@/lib/shared/timeline';
import { overlap, totalLength } from '@/lib/shared/ranges';
import { useEditor } from '@/lib/client/store';
import { useClipWords } from '@/lib/client/derived';
import { usePlayback } from '@/lib/client/player';
import { formatSeconds, formatTime } from '@/lib/client/format';
import {
  applyScript,
  copyText,
  downloadText,
  saveScript,
  clearCuts,
  cutSelectedWords,
  playSelectedWords,
  restoreSelectedWords,
  retranscribe,
  runCleanup,
  seekToWord,
  setWordText,
  toggleBreakSelected,
  toggleHiddenSelected,
  togglePause,
} from '@/lib/client/actions';
import { Button, Field, IconButton, Modal, ProgressBar, Toggle } from '@/components/ui';

const REASON_CLASS: Record<CutReason, string> = {
  manual: 'decoration-danger',
  silence: 'decoration-cut-silence',
  filler: 'decoration-cut-filler text-cut-filler/60',
  retake: 'decoration-cut-retake text-cut-retake/60',
};

const LANGUAGES = [
  ['es', 'Español'],
  ['en', 'Inglés'],
  ['pt', 'Portugués'],
  ['fr', 'Francés'],
  ['it', 'Italiano'],
  ['de', 'Alemán'],
  ['ca', 'Catalán'],
  ['auto', 'Detectar'],
] as const;

function CleanupBar() {
  const [open, setOpen] = useState(false);
  const settings = useEditor((s) => s.doc!.settings);
  const set = (fn: (d: typeof settings) => void, key: string) => useEditor.getState().commit((d) => fn(d.settings), key);
  return (
    <div className="border-b border-line p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <Sparkles size={13} className="text-accent" /> Auto-limpiar
        </span>
        <div className="flex items-center gap-1">
          <select
            value={settings.language}
            onChange={(e) => set((s) => void (s.language = e.target.value), 'language')}
            className="h-7 rounded-md border border-line-strong bg-panel-2 px-1.5 text-xs text-fg"
            title="Idioma de la transcripción"
          >
            {LANGUAGES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <IconButton label="Ajustes de limpieza" className="h-7 w-7" active={open} onClick={() => setOpen(!open)}>
            <Settings2 size={14} />
          </IconButton>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <Button size="sm" onClick={() => runCleanup('silence')} title={`Quita pausas de más de ${formatSeconds(settings.silenceMin)}`}>
          Silencios
        </Button>
        <Button size="sm" onClick={() => runCleanup('filler')} title={settings.fillers.join(', ')}>
          Muletillas
        </Button>
        <Button size="sm" onClick={() => runCleanup('retake')} title="Detecta frases repetidas y se queda con la última toma">
          Tomas repetidas
        </Button>
      </div>
      <Button variant="primary" size="sm" className="mt-1.5 w-full" onClick={() => runCleanup('all')}>
        <Sparkles size={13} /> Limpiar todo
      </Button>
      {open && (
        <div className="mt-3 flex flex-col gap-3 rounded-lg border border-line bg-panel-2 p-3">
          <Toggle
            label="Quitar silencios automáticamente al añadir clips"
            checked={settings.autoSilence}
            onChange={(v) => set((s) => void (s.autoSilence = v), 'autoSilence')}
          />
          <Field label="Silencio mínimo a quitar" hint={formatSeconds(settings.silenceMin, 2)}>
            <input
              type="range"
              min={0.2}
              max={2}
              step={0.05}
              value={settings.silenceMin}
              onChange={(e) => set((s) => void (s.silenceMin = Number(e.target.value)), 'silenceMin')}
            />
          </Field>
          <Field label="Margen que se conserva junto a la voz" hint={formatSeconds(settings.silencePadding, 2)}>
            <input
              type="range"
              min={0}
              max={0.3}
              step={0.01}
              value={settings.silencePadding}
              onChange={(e) => set((s) => void (s.silencePadding = Number(e.target.value)), 'silencePadding')}
            />
          </Field>
          <Field label="Muletillas (separadas por comas)">
            <input
              defaultValue={settings.fillers.join(', ')}
              onBlur={(e) =>
                set(
                  (s) =>
                    void (s.fillers = e.target.value
                      .split(',')
                      .map((x) => x.trim().toLowerCase())
                      .filter(Boolean)),
                  'fillers',
                )
              }
              className="h-8 rounded-md border border-line-strong bg-panel px-2 text-xs"
            />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => clearCuts('silence')}>
              Restaurar silencios
            </Button>
            <Button size="sm" variant="ghost" onClick={() => clearCuts('filler')}>
              Restaurar muletillas
            </Button>
            <Button size="sm" variant="ghost" onClick={() => clearCuts('retake')}>
              Restaurar tomas
            </Button>
            <Button size="sm" variant="danger" onClick={() => confirm('¿Quitar todos los cortes?') && clearCuts('all')}>
              Quitar todos los cortes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ScriptDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
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

function TextBar() {
  const [scriptOpen, setScriptOpen] = useState(false);
  const hasScript = useEditor((s) => !!s.doc?.script.trim());
  return (
    <div className="flex items-center gap-1 border-b border-line px-3 py-2">
      <span className="mr-auto text-xs font-semibold">Texto</span>
      <Button size="sm" variant="ghost" className="px-2" onClick={() => setScriptOpen(true)} title="Pegar o editar tu guión">
        <FileText size={13} /> Guión
      </Button>
      <Button size="sm" variant="ghost" className="px-2" onClick={copyText} title="Copiar el texto del vídeo">
        <Copy size={13} /> Copiar
      </Button>
      <Button size="sm" variant="ghost" className="px-2" onClick={() => downloadText('txt')} title="Descargar el texto (.txt)">
        <Download size={13} /> TXT
      </Button>
      <Button size="sm" variant="ghost" className="px-2" onClick={() => downloadText('srt')} title="Descargar subtítulos con tiempos (.srt)">
        <Download size={13} /> SRT
      </Button>
      {hasScript && (
        <IconButton label="Descargar el guión (.txt)" className="h-7 w-7" onClick={() => downloadText('script')}>
          <FileText size={13} />
        </IconButton>
      )}
      <ScriptDialog open={scriptOpen} onClose={() => setScriptOpen(false)} />
    </div>
  );
}

function NoTranscriberBanner() {
  const missing = useEditor((s) => s.status?.transcriber === 'none');
  if (!missing) return null;
  return (
    <div className="flex items-center gap-3 border-b border-accent/30 bg-accent/5 px-3 py-2.5 text-xs">
      <Captions size={16} className="shrink-0 text-accent" />
      <span className="flex-1 text-muted">
        Para crear los subtítulos falta instalar la transcripción local (gratis, sin API). Los silencios ya se pueden quitar.
      </span>
      <Button size="sm" variant="primary" onClick={() => useEditor.getState().set({ setupOpen: true })}>
        Instalar
      </Button>
    </div>
  );
}

function SelectionBar({ count, allDeleted }: { count: number; allDeleted: boolean }) {
  return (
    <div className="absolute inset-x-3 bottom-3 z-10 flex items-center gap-1 rounded-lg border border-line-strong bg-panel-2/95 px-2 py-1.5 shadow-2xl shadow-black/60 backdrop-blur">
      <span className="mr-0.5 text-[11px] whitespace-nowrap text-muted tabular-nums">{count} pal.</span>
      {!allDeleted && (
        <Button size="sm" variant="primary" className="px-2" onClick={cutSelectedWords} title="Cortar (Supr)">
          <Scissors size={12} /> Cortar
        </Button>
      )}
      <Button size="sm" className="px-2" onClick={restoreSelectedWords}>
        <RotateCcw size={12} /> Restaurar
      </Button>
      <IconButton label="Reproducir selección" className="h-7 w-7" onClick={playSelectedWords}>
        <Play size={13} />
      </IconButton>
      <IconButton label="Ocultar / mostrar en subtítulos" className="h-7 w-7" onClick={toggleHiddenSelected}>
        <EyeOff size={13} />
      </IconButton>
      <IconButton label="Empezar un subtítulo nuevo aquí" className="h-7 w-7" onClick={toggleBreakSelected}>
        <Pilcrow size={13} />
      </IconButton>
      <div className="flex-1" />
      <IconButton label="Quitar selección (Esc)" className="h-7 w-7" onClick={() => useEditor.getState().setSelection(null)}>
        <X size={13} />
      </IconButton>
    </div>
  );
}

function ClipHeader({ cw, n }: { cw: ClipWords; n: number }) {
  const media = useEditor((s) => s.media[cw.clip.mediaId]);
  const kept = totalLength(keptRanges(cw.clip));
  const t = media?.transcript;
  return (
    <div className="mb-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
        <span className="rounded bg-panel-3 px-1.5 py-0.5 text-fg">Clip {n}</span>
        <span className="min-w-0 flex-1 truncate normal-case" title={media?.name}>
          {media?.name ?? 'Medio no encontrado'}
        </span>
        <span className="font-normal normal-case tabular-nums">
          {formatTime(kept, false)} / {formatTime(cw.clip.end - cw.clip.start, false)}
        </span>
        {t?.status === 'done' && (
          <IconButton
            label="Volver a transcribir"
            className="h-6 w-6"
            onClick={() => confirm('Se perderán las correcciones de texto de este clip. ¿Continuar?') && retranscribe(cw.clip.mediaId)}
          >
            <RefreshCw size={11} />
          </IconButton>
        )}
      </div>
      {t && (t.status === 'queued' || t.status === 'running') && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">
            {t.status === 'queued' ? 'En cola para transcribir…' : `Transcribiendo… ${Math.round(t.progress * 100)}%`}
          </span>
          <ProgressBar value={t.progress} indeterminate={t.status === 'queued' || t.progress <= 0.02} />
        </div>
      )}
      {cw.clip.autoClean && (t?.status === 'queued' || t?.status === 'running' || media?.status === 'processing') && (
        <p className="text-[11px] text-faint">Los silencios se quitarán solos en cuanto termine el análisis.</p>
      )}
      {t?.status === 'error' && (
        <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 p-2 text-xs text-danger">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span className="flex-1 whitespace-pre-line">{t.error}</span>
          <Button size="sm" variant="ghost" onClick={() => retranscribe(cw.clip.mediaId)}>
            Reintentar
          </Button>
        </div>
      )}
      {t?.status === 'none' && media?.hasAudio && (
        <Button size="sm" className="self-start" onClick={() => retranscribe(cw.clip.mediaId)}>
          <Captions size={12} /> Transcribir
        </Button>
      )}
      {media && !media.hasAudio && <p className="text-xs text-faint">Este clip no tiene audio.</p>}
    </div>
  );
}

function PauseMark({ gap, kept, onToggle }: { gap: Range; kept: Range[]; onToggle: () => void }) {
  const dur = gap.end - gap.start;
  const keptDur = kept.reduce((s, r) => s + overlap(r, gap), 0);
  const cut = keptDur < dur * 0.5;
  return (
    <button
      data-gap
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onToggle}
      title={cut ? 'Pausa eliminada: clic para restaurarla' : 'Clic para eliminar esta pausa'}
      className={clsx(
        'mx-1 inline-flex items-center rounded px-1 align-[1px] font-mono text-[10px] leading-4',
        cut ? 'bg-transparent text-faint line-through' : 'bg-panel-3 text-muted hover:bg-accent hover:text-black',
      )}
    >
      {formatSeconds(dur)}
    </button>
  );
}

function wordClass(v: WordView, selected: boolean) {
  return clsx(
    'cursor-pointer rounded-[3px] px-[1px] transition-colors data-[active]:bg-accent data-[active]:text-black',
    v.deleted ? clsx('text-faint line-through decoration-2', REASON_CLASS[v.reason ?? 'manual']) : 'hover:bg-panel-3',
    v.hidden && !v.deleted && 'text-muted italic',
    selected && 'bg-accent/25 text-fg',
  );
}

export function TranscriptPanel() {
  const clipWords = useClipWords();
  const doc = useEditor((s) => s.doc)!;
  const selection = useEditor((s) => s.selection);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ anchor: number; moved: boolean; shift: boolean } | null>(null);
  const [editing, setEditing] = useState<number | null>(null);

  const offsets = useMemo(() => {
    let o = 0;
    return clipWords.map((cw) => {
      const start = o;
      o += cw.views.length;
      return start;
    });
  }, [clipWords]);
  const flat = useMemo(() => clipWords.flatMap((cw) => cw.views), [clipWords]);
  const keptByClip = useMemo(() => clipWords.map((cw) => keptRanges(cw.clip)), [clipWords]);
  const sel = selection?.kind === 'words' ? [Math.min(selection.anchor, selection.focus), Math.max(selection.anchor, selection.focus)] : null;

  // Highlight the word being played without re-rendering the transcript.
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const timed = flat
      .map((v, i) => ({ i, start: v.tlStart, end: v.tlEnd }))
      .filter((x): x is { i: number; start: number; end: number } => x.start !== null && x.end !== null);
    let current = -1;
    root.querySelectorAll('[data-active]').forEach((el) => el.removeAttribute('data-active'));
    const apply = (t: number, playing: boolean) => {
      let lo = 0;
      let hi = timed.length - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (timed[mid].start <= t + 1e-3) {
          found = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      const next = found >= 0 && t < Math.max(timed[found].end, (timed[found + 1]?.start ?? Infinity) - 0.25) ? timed[found].i : -1;
      if (next === current) return;
      root.querySelector(`[data-k="${current}"]`)?.removeAttribute('data-active');
      current = next;
      const el = next >= 0 ? root.querySelector(`[data-k="${next}"]`) : null;
      if (!el) return;
      el.setAttribute('data-active', '');
      if (playing) {
        const box = root.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        if (r.top < box.top + 40 || r.bottom > box.bottom - 40) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    };
    const s = usePlayback.getState();
    apply(s.time, false);
    return usePlayback.subscribe((st) => apply(st.time, st.playing));
  }, [flat]);

  useEffect(() => {
    const up = () => void (drag.current = null);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const indexFrom = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('[data-k]');
    return el ? Number((el as HTMLElement).dataset.k) : null;
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const k = indexFrom(e);
    const st = useEditor.getState();
    if (k === null) {
      if (!(e.target as HTMLElement).closest('button,input')) st.setSelection(null);
      return;
    }
    e.preventDefault();
    if (e.shiftKey && st.selection?.kind === 'words') {
      st.setSelection({ kind: 'words', anchor: st.selection.anchor, focus: k });
      drag.current = { anchor: k, moved: true, shift: true };
      return;
    }
    st.setSelection({ kind: 'words', anchor: k, focus: k });
    drag.current = { anchor: k, moved: false, shift: false };
    const v = flat[k];
    if (v)
      seekToWord(
        clipWords.findIndex((cw) => cw.clip.id === v.clipId),
        v.index,
      );
  };

  const onMouseOver = (e: React.MouseEvent) => {
    const d = drag.current;
    if (!d || d.shift) return;
    const k = indexFrom(e);
    if (k === null) return;
    if (k !== d.anchor) d.moved = true;
    const st = useEditor.getState();
    if (st.selection?.kind === 'words' && st.selection.focus !== k) st.setSelection({ kind: 'words', anchor: d.anchor, focus: k });
  };

  const hasAnyWords = flat.length > 0;
  const allDeleted = !!sel && flat.slice(sel[0], sel[1] + 1).every((v) => v.deleted);

  return (
    <div className="flex h-full flex-col">
      <NoTranscriberBanner />
      <CleanupBar />
      <TextBar />
      <div className="relative min-h-0 flex-1">
        <div
          ref={ref}
          className="h-full overflow-y-auto px-4 pt-3 pb-24 select-none"
          onMouseDown={onMouseDown}
          onMouseOver={onMouseOver}
          onDoubleClick={(e) => {
            const k = indexFrom(e);
            if (k !== null) setEditing(k);
          }}
        >
          {!doc.clips.length && <p className="mt-10 text-center text-sm text-faint">Sube un clip para ver aquí su transcripción.</p>}
          {doc.clips.length > 0 && !hasAnyWords && clipWords.every((cw) => !cw.words.length) && (
            <p className="mb-4 text-xs text-faint">
              La transcripción aparecerá aquí en cuanto termine. Mientras, ya puedes quitar silencios con el análisis de audio.
            </p>
          )}
          {clipWords.map((cw, ci) => {
            const kept = keptByClip[ci];
            const min = doc.settings.silenceMin;
            const lead = cw.words.length ? cw.words[0].start - cw.clip.start : 0;
            return (
              <section key={cw.clip.id} className="mb-6">
                <ClipHeader cw={cw} n={ci + 1} />
                <p className="text-[15px] leading-[2.05] text-fg">
                  {lead >= min && (
                    <PauseMark gap={{ start: cw.clip.start, end: cw.words[0].start }} kept={kept} onToggle={() => togglePause(ci, -1)} />
                  )}
                  {cw.views.map((v, i) => {
                    const k = offsets[ci] + i;
                    const nextStart = i + 1 < cw.words.length ? cw.words[i + 1].start : cw.clip.end;
                    const gap = nextStart - v.word.end;
                    const selected = !!sel && k >= sel[0] && k <= sel[1];
                    return (
                      <Fragment key={v.key}>
                        {v.breakBefore && <Pilcrow size={11} className="mx-0.5 inline align-[-1px] text-accent/70" />}
                        {editing === k ? (
                          <input
                            autoFocus
                            defaultValue={v.text}
                            onMouseDown={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                              if (e.key === 'Escape') setEditing(null);
                            }}
                            onBlur={(e) => {
                              if (editing === k) setWordText(v.key, e.target.value, v.word.text);
                              setEditing(null);
                            }}
                            className="w-28 rounded border border-accent bg-panel-2 px-1 text-[15px] leading-6 text-fg outline-none"
                            style={{ width: `${Math.max(4, v.text.length + 2)}ch` }}
                          />
                        ) : (
                          <span
                            data-k={k}
                            className={wordClass(v, selected)}
                            title={
                              v.deleted
                                ? `Eliminada (${v.reason === 'silence' ? 'silencio' : v.reason === 'filler' ? 'muletilla' : v.reason === 'retake' ? 'toma repetida' : 'manual'})`
                                : undefined
                            }
                          >
                            {v.text}
                          </span>
                        )}
                        {gap >= min ? <PauseMark gap={{ start: v.word.end, end: nextStart }} kept={kept} onToggle={() => togglePause(ci, i)} /> : ' '}
                      </Fragment>
                    );
                  })}
                </p>
              </section>
            );
          })}
          {hasAnyWords && (
            <p className="mt-2 border-t border-line pt-3 text-[11px] leading-relaxed text-faint">
              Clic: saltar a la palabra · Arrastrar o Shift+clic: seleccionar · <b className="text-muted">Supr</b>: cortar · Doble clic: corregir
              texto · Las etiquetas grises son pausas: clic para quitarlas o recuperarlas.
            </p>
          )}
        </div>
        {sel && <SelectionBar count={sel[1] - sel[0] + 1} allDeleted={allDeleted} />}
      </div>
    </div>
  );
}
