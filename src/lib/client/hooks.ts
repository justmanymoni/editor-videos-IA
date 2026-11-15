'use client';
import { useCallback, useEffect, useRef } from 'react';
import { api } from './api';
import { useEditor } from './store';
import { player, usePlayback } from './player';
import { deleteSelection, splitAtPlayhead, stepFrames, trimAtPlayhead } from './actions';
import { computeSilenceCuts } from '@/lib/shared/cleanup';
import { replaceCuts } from '@/lib/shared/edit';
import { buildSegments, sequenceDuration, wordsInClip } from '@/lib/shared/timeline';
import { formatSeconds } from './format';

/**
 * Polls media that is still processing or transcribing, and loads
 * transcripts and loudness envelopes as soon as they are available.
 */
export function useMediaSync() {
  useEffect(() => {
    const inflight = new Set<string>();
    const missing = new Set<string>();
    const envelopeFrom = new Set<string>();
    const separationSeen = new Map<string, string>();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      const s = useEditor.getState();
      if (s.doc) {
        const ids = [...new Set([...s.doc.media, ...s.resourceIds])].filter((id) => !missing.has(id));
        const pending = ids.filter((id) => {
          const m = s.media[id];
          const sep = m?.separation?.status;
          return (
            !m ||
            m.status === 'processing' ||
            m.transcript.status === 'queued' ||
            m.transcript.status === 'running' ||
            sep === 'queued' ||
            sep === 'running'
          );
        });
        if (pending.length) {
          try {
            const list = await api.media(pending);
            useEditor.getState().upsertMedia(list);
            const found = new Set(list.map((m) => m.id));
            for (const id of pending) if (!found.has(id)) missing.add(id);
          } catch {
            // Server restarting: try again on the next tick.
          }
        }
        const now = useEditor.getState();
        for (const id of ids) {
          const m = now.media[id];
          if (!m) continue;
          if (m.role === 'clip' && m.transcript.status === 'done' && !now.transcripts[id] && !inflight.has(`t:${id}`)) {
            inflight.add(`t:${id}`);
            api
              .transcript(id)
              .then((t) => useEditor.getState().setTranscript(id, t.words))
              .catch(() => undefined)
              .finally(() => inflight.delete(`t:${id}`));
          }
          // Once voice and music are separated, silences are detected on the clean voice.
          const voiceStem = m.separation?.status === 'done';
          const envKey = `${voiceStem ? 'v' : 'e'}:${id}`;
          if (m.hasEnvelope && !envelopeFrom.has(envKey) && !inflight.has(envKey)) {
            inflight.add(envKey);
            api
              .envelope(id, voiceStem ? 'voice' : undefined)
              .then((env) => {
                envelopeFrom.add(envKey);
                useEditor.getState().setEnvelope(id, env);
              })
              .catch(() => undefined)
              .finally(() => inflight.delete(envKey));
          }
          const before = separationSeen.get(id);
          const after = m.separation?.status;
          if (before && before !== after && (before === 'running' || before === 'queued')) {
            if (after === 'done') {
              now.toast(`Voz y música separadas en «${m.name}». Elige en su tarjeta qué quieres escuchar.`, 'success');
            } else if (after === 'error') now.toast(`No se pudo separar «${m.name}»: ${m.separation.error ?? ''}`, 'error');
          }
          if (after) separationSeen.set(id, after);
        }
      }
      if (!stopped) timer = setTimeout(tick, 1000);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
}

/**
 * Removes the silences of newly added clips as soon as their audio analysis
 * and transcript are ready (or transcription is not available). Runs once per
 * clip; the result can be undone like any other edit.
 */
export function useAutoSilence() {
  useEffect(() => {
    const handled = new Set<string>();
    const check = () => {
      const s = useEditor.getState();
      if (!s.doc) return;
      const ready = s.doc.clips.filter((c) => {
        if (!c.autoClean || handled.has(c.id)) return false;
        const m = s.media[c.mediaId];
        if (!m) return false;
        if (!m.hasAudio || m.status === 'error') return true;
        const t = m.transcript.status;
        if (t === 'queued' || t === 'running') return false;
        if (t === 'done' && !s.transcripts[m.id]) return false;
        if (!m.hasEnvelope) return m.status !== 'processing';
        return !!s.envelopes[m.id];
      });
      if (!ready.length) return;
      for (const c of ready) handled.add(c.id);
      const ids = new Set(ready.map((c) => c.id));
      queueMicrotask(() => {
        const st = useEditor.getState();
        if (!st.doc) return;
        const before = sequenceDuration(buildSegments(st.doc.clips));
        st.commitDoc((d) => ({
          ...d,
          clips: d.clips.map((c) => {
            if (!ids.has(c.id)) return c;
            const { autoClean: _done, ...clip } = c;
            if (!d.settings.autoSilence) return clip;
            const cuts = computeSilenceCuts(
              clip,
              wordsInClip(st.transcripts[c.mediaId], clip),
              st.envelopes[c.mediaId],
              d.settings.silenceMin,
              d.settings.silencePadding,
            );
            return replaceCuts(clip, 'silence', cuts);
          }),
        }));
        const after = useEditor.getState().doc;
        const saved = after ? before - sequenceDuration(buildSegments(after.clips)) : 0;
        if (saved > 0.05) st.toast(`Silencios quitados automáticamente: −${formatSeconds(saved)}`, 'success');
      });
    };
    check();
    return useEditor.subscribe(check);
  }, []);
}

/**
 * Keeps a preview video for every clip whose voice/music mix was changed, so
 * the player sounds exactly like the export (rendered on the server).
 */
export function useMixPreviews() {
  useEffect(() => {
    const requested = new Map<string, string>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const sync = async () => {
      const s = useEditor.getState();
      const mixes = s.doc?.audioMix ?? {};
      for (const id of Object.keys(s.mixUrls)) {
        if (!mixes[id]) {
          const { [id]: _gone, ...rest } = useEditor.getState().mixUrls;
          useEditor.getState().set({ mixUrls: rest });
          requested.delete(id);
        }
      }
      for (const [id, mix] of Object.entries(mixes)) {
        if (s.media[id]?.separation?.status !== 'done') continue;
        const key = `${mix.voice}:${mix.music}`;
        if (requested.get(id) === key) continue;
        requested.set(id, key);
        try {
          let res = await api.mix(id, mix.voice, mix.music);
          while (res.jobId) {
            await new Promise((r) => setTimeout(r, 700));
            const job = await api.job(res.jobId);
            if (job.status === 'error') throw new Error(job.error ?? 'Error al preparar la mezcla');
            if (job.status === 'done') res = await api.mix(id, mix.voice, mix.music);
          }
          if (res.url && requested.get(id) === key) useEditor.getState().set({ mixUrls: { ...useEditor.getState().mixUrls, [id]: res.url } });
        } catch (e) {
          requested.delete(id);
          useEditor.getState().toast(e instanceof Error ? e.message : String(e), 'error');
        }
      }
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void sync(), 400);
    };
    schedule();
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.doc?.audioMix !== prev.doc?.audioMix || s.media !== prev.media) schedule();
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, []);
}

/** Saves the project 800 ms after the last change. Returns a "save now" function. */
export function useAutosave() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    const s = useEditor.getState();
    const doc = s.doc;
    if (!doc) return;
    s.set({ saveState: 'saving' });
    try {
      await api.saveProject(doc);
      if (useEditor.getState().doc === doc) useEditor.getState().set({ saveState: 'saved' });
    } catch {
      useEditor.getState().set({ saveState: 'error' });
    }
  }, []);

  useEffect(() => {
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.doc !== prev.doc && s.saveState === 'pending') {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(save, 800);
      }
    });
    const beforeUnload = (e: BeforeUnloadEvent) => {
      const st = useEditor.getState().saveState;
      if (st === 'pending' || st === 'saving') e.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      unsub();
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [save]);

  return save;
}

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && el.closest('input, textarea, select, [contenteditable="true"]') !== null;

/**
 * Space = play/pause, S = split, Supr/Backspace = delete selection,
 * Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y = undo/redo, arrows = frame step.
 */
export function useShortcuts(saveNow: () => void, openHelp: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.defaultPrevented) return;
      const s = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && key === 's') {
        e.preventDefault();
        saveNow();
        return;
      }
      if (mod || e.altKey) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          player.toggle();
          break;
        case 's':
        case 'S':
          e.preventDefault();
          splitAtPlayhead();
          break;
        case 'q':
        case 'Q':
          e.preventDefault();
          trimAtPlayhead('left');
          break;
        case 'w':
        case 'W':
          e.preventDefault();
          trimAtPlayhead('right');
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          deleteSelection();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          stepFrames(e.shiftKey ? -30 : -1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          stepFrames(e.shiftKey ? 30 : 1);
          break;
        case 'Home':
          e.preventDefault();
          player.seek(0);
          break;
        case 'End':
          e.preventDefault();
          player.seek(usePlayback.getState().duration);
          break;
        case 'Escape':
          s.setSelection(null);
          break;
        case '?':
          openHelp();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveNow, openHelp]);
}

/** Stable ref callbacks per key (inline refs would re-register on every render). */
export function useKeyedRefs<T>(register: (key: string, el: T | null) => void) {
  const cache = useRef(new Map<string, (el: T | null) => void>());
  return useCallback(
    (key: string) => {
      let fn = cache.current.get(key);
      if (!fn) {
        fn = (el: T | null) => register(key, el);
        cache.current.set(key, fn);
      }
      return fn;
    },
    [register],
  );
}
