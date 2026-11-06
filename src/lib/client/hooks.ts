'use client';
import { useCallback, useEffect, useRef } from 'react';
import { api } from './api';
import { useEditor } from './store';
import { player, usePlayback } from './player';
import { deleteSelection, splitAtPlayhead, stepFrames } from './actions';

/**
 * Polls media that is still processing or transcribing, and loads
 * transcripts and loudness envelopes as soon as they are available.
 */
export function useMediaSync() {
  useEffect(() => {
    const inflight = new Set<string>();
    const missing = new Set<string>();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      const s = useEditor.getState();
      if (s.doc) {
        const ids = [...new Set([...s.doc.media, ...s.resourceIds])].filter((id) => !missing.has(id));
        const pending = ids.filter((id) => {
          const m = s.media[id];
          return !m || m.status === 'processing' || m.transcript.status === 'queued' || m.transcript.status === 'running';
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
          if (m.hasEnvelope && !now.envelopes[id] && !inflight.has(`e:${id}`)) {
            inflight.add(`e:${id}`);
            api
              .envelope(id)
              .then((env) => useEditor.getState().setEnvelope(id, env))
              .catch(() => undefined)
              .finally(() => inflight.delete(`e:${id}`));
          }
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
