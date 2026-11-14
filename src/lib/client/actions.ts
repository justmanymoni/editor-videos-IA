'use client';
/**
 * Editor commands used by buttons, keyboard shortcuts and the timeline.
 * They read the current state, apply pure edit functions and commit one
 * undoable step.
 */
import { nanoid } from 'nanoid';
import type { AudioItem, BrollItem, MainClip, MediaInfo, ProjectDoc, WordOverride } from '@/lib/shared/types';
import { wordKey } from '@/lib/shared/types';
import { FRAME, quantize } from '@/lib/shared/ranges';
import { buildClipWords, buildSegments, keptRanges, sequenceDuration, sourceToTimeline, timelineToSource, wordsInClip } from '@/lib/shared/timeline';
import { addCuts, moveRange, replaceCuts, restoreRanges, splitClip, splitItem, trimRange, wordRunRanges } from '@/lib/shared/edit';
import { computeFillerCuts, computeRetakeCuts, computeSilenceCuts } from '@/lib/shared/cleanup';
import { alignScript } from '@/lib/shared/script';
import { buildSrt, buildVtt, captionPages, transcriptText } from '@/lib/shared/text-export';
import { api, uploadFile } from './api';
import { currentDerived } from './derived';
import { formatSeconds, formatTime } from './format';
import { player, usePlayback } from './player';
import { useEditor } from './store';

const newId = () => nanoid(10);
const ed = () => useEditor.getState();
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------- words

/** Flat list of every transcript word in timeline order. */
export function flatWords() {
  const out: { clipIndex: number; index: number }[] = [];
  currentDerived().clipWords.forEach((cw) => cw.views.forEach((v) => out.push({ clipIndex: cw.clipIndex, index: v.index })));
  return out;
}

/** Selected word indices grouped by clip index. */
export function selectedWords(): Map<number, number[]> {
  const sel = ed().selection;
  const groups = new Map<number, number[]>();
  if (sel?.kind !== 'words') return groups;
  const flat = flatWords();
  const lo = Math.min(sel.anchor, sel.focus);
  const hi = Math.max(sel.anchor, sel.focus);
  for (let i = lo; i <= hi && i < flat.length; i++) {
    const f = flat[i];
    if (!groups.has(f.clipIndex)) groups.set(f.clipIndex, []);
    groups.get(f.clipIndex)!.push(f.index);
  }
  return groups;
}

function updateWordRanges(groups: Map<number, number[]>, restore: boolean) {
  if (!groups.size) return;
  const { clipWords } = currentDerived();
  ed().commitDoc((doc) => ({
    ...doc,
    clips: doc.clips.map((c, ci) => {
      const idx = groups.get(ci);
      if (!idx?.length || !clipWords[ci]) return c;
      const ranges = wordRunRanges(clipWords[ci].words, idx);
      return restore ? restoreRanges(c, ranges) : addCuts(c, ranges, 'manual');
    }),
  }));
}

export const cutSelectedWords = () => updateWordRanges(selectedWords(), false);
export const restoreSelectedWords = () => updateWordRanges(selectedWords(), true);
export const restoreWord = (clipIndex: number, index: number) => updateWordRanges(new Map([[clipIndex, [index]]]), true);

function selectedKeys(): string[] {
  const { clipWords } = currentDerived();
  const keys: string[] = [];
  for (const [ci, idx] of selectedWords()) for (const i of idx) keys.push(clipWords[ci].views[i].key);
  return keys;
}

function patchWords(keys: string[], patch: (prev: WordOverride | undefined) => WordOverride, coalesceKey?: string) {
  if (!keys.length) return;
  ed().commit((d) => {
    for (const k of keys) {
      const next = patch(d.words[k]);
      const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && v !== false && v !== ''));
      if (Object.keys(clean).length) d.words[k] = clean;
      else delete d.words[k];
    }
  }, coalesceKey);
}

export function setWordText(key: string, text: string, original: string) {
  const value = text.trim();
  patchWords([key], (prev) => ({ ...prev, text: value && value !== original ? value : undefined }));
}

export function toggleHiddenSelected() {
  const keys = selectedKeys();
  const doc = ed().doc;
  if (!doc || !keys.length) return;
  const hide = !keys.every((k) => doc.words[k]?.hidden);
  patchWords(keys, (prev) => ({ ...prev, hidden: hide }));
}

export function toggleBreakSelected() {
  const keys = selectedKeys();
  const doc = ed().doc;
  if (!doc || !keys.length) return;
  patchWords([keys[0]], (prev) => ({ ...prev, breakBefore: !doc.words[keys[0]]?.breakBefore }));
}

export function playSelectedWords() {
  const { clipWords } = currentDerived();
  let start = Infinity;
  let end = -Infinity;
  for (const [ci, idx] of selectedWords()) {
    for (const i of idx) {
      const v = clipWords[ci].views[i];
      if (v.tlStart !== null && v.tlEnd !== null) {
        start = Math.min(start, v.tlStart);
        end = Math.max(end, v.tlEnd);
      }
    }
  }
  if (start < end) player.playRange(start, end);
}

/** Seeks to a word; for a removed word, to where it would have been. */
export function seekToWord(clipIndex: number, index: number) {
  const { clipWords, segs } = currentDerived();
  const v = clipWords[clipIndex]?.views[index];
  if (!v) return;
  const t = v.tlStart ?? sourceToTimeline(segs, v.clipId, v.word.start, 'next');
  if (t !== null) player.seek(t);
}

/** Toggles the pause after word `index` (cut ↔ restored). */
export function togglePause(clipIndex: number, index: number) {
  const { clipWords } = currentDerived();
  const cw = clipWords[clipIndex];
  const doc = ed().doc;
  if (!cw || !doc) return;
  const prevEnd = index < 0 ? cw.clip.start : cw.words[index].end;
  const nextStart = index + 1 < cw.words.length ? cw.words[index + 1].start : cw.clip.end;
  const gap = { start: prevEnd, end: nextStart };
  const kept = keptRanges(cw.clip).reduce((s, r) => s + Math.max(0, Math.min(r.end, gap.end) - Math.max(r.start, gap.start)), 0);
  const isCut = kept < (gap.end - gap.start) * 0.5;
  const pad = doc.settings.silencePadding;
  ed().commitDoc((d) => ({
    ...d,
    clips: d.clips.map((c, ci) => {
      if (ci !== clipIndex) return c;
      if (isCut) return restoreRanges(c, [gap]);
      const start = index < 0 ? gap.start : gap.start + pad;
      const end = index + 1 >= cw.words.length ? gap.end : gap.end - pad;
      return end - start > 2 * FRAME ? addCuts(c, [{ start, end }], 'silence') : c;
    }),
  }));
}

// ------------------------------------------------------------- timeline

const replaceAt = <T>(list: T[], index: number, items: T[]) => [...list.slice(0, index), ...items, ...list.slice(index + 1)];

export function splitAtPlayhead() {
  const s = ed();
  const doc = s.doc;
  if (!doc) return;
  const t = usePlayback.getState().time;
  const sel = s.selection;
  if (sel?.kind === 'broll' || sel?.kind === 'audio') {
    const key = sel.kind === 'broll' ? 'broll' : 'audio';
    const list = doc[key] as (BrollItem | AudioItem)[];
    const i = list.findIndex((x) => x.id === sel.id);
    const parts = i >= 0 ? splitItem(list[i], t, newId) : null;
    if (!parts) return s.toast('Coloca el cursor dentro del elemento seleccionado para dividirlo');
    s.commitDoc((d) => ({ ...d, [key]: replaceAt(d[key] as (BrollItem | AudioItem)[], i, parts) }));
    s.setSelection({ kind: sel.kind, id: parts[1].id });
    return;
  }
  if (sel?.kind === 'subtitle') {
    const page = currentDerived().pages[sel.page];
    const word = page?.words.findLast((w, i) => i > 0 && w.start <= t);
    if (!word) return s.toast('Coloca el cursor entre dos palabras del subtítulo');
    s.commit((d) => {
      d.words[word.key] = { ...d.words[word.key], breakBefore: true };
    });
    return;
  }
  const loc = timelineToSource(currentDerived().segs, t);
  if (!loc) return;
  const parts = splitClip(doc.clips[loc.seg.clipIndex], quantize(loc.src), newId);
  if (!parts) return s.toast('El cursor está en el borde de un clip');
  s.commitDoc((d) => ({ ...d, clips: replaceAt(d.clips, loc.seg.clipIndex, parts) }));
}

export function deleteSelection() {
  const s = ed();
  const sel = s.selection;
  if (!sel || !s.doc) return;
  switch (sel.kind) {
    case 'words':
      cutSelectedWords();
      return;
    case 'segment': {
      s.commitDoc((d) => ({
        ...d,
        clips: d.clips.map((c) => {
          if (c.id !== sel.clipId) return c;
          const r = keptRanges(c)[sel.rangeIndex];
          return r ? addCuts(c, [r], 'manual') : c;
        }),
      }));
      break;
    }
    case 'broll':
      s.commitDoc((d) => ({ ...d, broll: d.broll.filter((b) => b.id !== sel.id) }));
      break;
    case 'audio':
      s.commitDoc((d) => ({ ...d, audio: d.audio.filter((a) => a.id !== sel.id) }));
      break;
    case 'subtitle': {
      const page = currentDerived().pages[sel.page];
      if (page)
        patchWords(
          page.words.map((w) => w.key),
          (prev) => ({ ...prev, hidden: true }),
        );
      break;
    }
  }
  s.setSelection(null);
}

export function trimSegment(clipId: string, rangeIndex: number, edge: 'start' | 'end', src: number) {
  const s = ed();
  s.commitDoc((d) => ({
    ...d,
    clips: d.clips.map((c) => (c.id === clipId ? trimRange(c, rangeIndex, edge, quantize(src), s.media[c.mediaId]?.duration ?? c.end) : c)),
  }));
}

export function moveSegment(clipId: string, rangeIndex: number, dropTime: number) {
  ed().commitDoc((d) => ({ ...d, clips: moveRange(d.clips, clipId, rangeIndex, dropTime, newId) }));
  ed().setSelection(null);
}

export function updateItem(kind: 'broll' | 'audio', id: string, patch: Partial<BrollItem & AudioItem>, coalesceKey?: string) {
  ed().commit((d) => {
    const list = d[kind] as (BrollItem | AudioItem)[];
    const item = list.find((x) => x.id === id);
    if (item) Object.assign(item, patch);
  }, coalesceKey);
}

const withMedia = (doc: ProjectDoc, id: string): string[] => (doc.media.includes(id) ? doc.media : [...doc.media, id]);

export function addClipInstance(media: MediaInfo) {
  ed().commitDoc((d) => {
    const clip: MainClip = {
      id: newId(),
      mediaId: media.id,
      start: 0,
      end: media.duration,
      cuts: [],
      autoClean: d.settings.autoSilence || undefined,
    };
    return { ...d, media: withMedia(d, media.id), clips: [...d.clips, clip] };
  });
}

export function addBroll(media: MediaInfo, start: number, length?: number) {
  const total = usePlayback.getState().duration;
  const duration = length ?? (media.kind === 'image' ? 3 : Math.min(media.duration, 5));
  const item: BrollItem = {
    id: newId(),
    mediaId: media.id,
    start: Math.max(0, Math.min(start, Math.max(0, total - 0.5))),
    duration: Math.max(0.5, duration),
    srcIn: 0,
  };
  ed().commitDoc((d) => ({ ...d, media: withMedia(d, media.id), broll: [...d.broll, item] }));
  ed().setSelection({ kind: 'broll', id: item.id });
}

export function addAudio(media: MediaInfo, start: number) {
  const total = usePlayback.getState().duration;
  const s0 = Math.max(0, start);
  const item: AudioItem = {
    id: newId(),
    mediaId: media.id,
    start: s0,
    duration: Math.min(media.duration, Math.max(total - s0, 5)),
    srcIn: 0,
    volume: 0.25,
    fadeIn: 0.5,
    fadeOut: 1,
  };
  ed().commitDoc((d) => ({ ...d, media: withMedia(d, media.id), audio: [...d.audio, item] }));
  ed().setSelection({ kind: 'audio', id: item.id });
}

export function removeMediaFromProject(mediaId: string) {
  ed().commitDoc((d) => ({
    ...d,
    media: d.media.filter((m) => m !== mediaId),
    clips: d.clips.filter((c) => c.mediaId !== mediaId),
    broll: d.broll.filter((b) => b.mediaId !== mediaId),
    audio: d.audio.filter((a) => a.mediaId !== mediaId),
  }));
  ed().setSelection(null);
}

export function stepFrames(frames: number) {
  player.pause();
  player.seek(usePlayback.getState().time + frames * FRAME);
}

// ------------------------------------------------------- script and text

export const saveScript = (script: string) => ed().commit((d) => void (d.script = script), 'script');

/**
 * Replaces the recognised wording with the script's (same timing). Only the
 * words that remain in the edited video are aligned, so clean up first.
 */
export function applyScript(script: string) {
  const s = ed();
  const { clipWords } = currentDerived();
  const views = clipWords.flatMap((cw) => cw.views.filter((v) => !v.deleted));
  if (!views.length) return s.toast('Primero hace falta la transcripción del vídeo para sincronizar el guión', 'error');
  let res;
  try {
    res = alignScript(
      views.map((v) => v.word.text),
      script,
    );
  } catch (e) {
    return s.toast(errorText(e), 'error');
  }
  s.commit((d) => {
    d.script = script;
    views.forEach((v, i) => {
      const text = res.texts.get(i);
      const prev = d.words[v.key] ?? {};
      const next = { ...prev, text: text && text !== v.word.text ? text : undefined };
      if (next.text === undefined) delete next.text;
      if (Object.keys(next).length) d.words[v.key] = next;
      else delete d.words[v.key];
    });
  });
  const extra = res.extraSpoken ? ` · ${res.extraSpoken} palabras dichas que no están en el guión (se mantienen)` : '';
  s.toast(`Guión aplicado: ${res.matched} palabras coinciden, ${res.changed} corregidas${extra}`, 'success');
}

function saveFile(name: string, content: string, type = 'text/plain') {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export type TextFormat = 'txt' | 'srt' | 'vtt' | 'script';

export function downloadText(format: TextFormat) {
  const doc = ed().doc;
  if (!doc) return;
  const { clipWords } = currentDerived();
  const base = (doc.name || 'transcripcion').replace(/[\\/:*?"<>|]+/g, '-');
  if (format === 'script') return saveFile(`${base} - guion.txt`, doc.script);
  const text = transcriptText(clipWords);
  if (!text) return ed().toast('Todavía no hay texto: espera a que termine la transcripción', 'error');
  if (format === 'txt') saveFile(`${base}.txt`, text);
  else if (format === 'srt') saveFile(`${base}.srt`, buildSrt(captionPages(clipWords)), 'application/x-subrip');
  else saveFile(`${base}.vtt`, buildVtt(captionPages(clipWords)), 'text/vtt');
}

export async function copyText() {
  const text = transcriptText(currentDerived().clipWords);
  if (!text) return ed().toast('Todavía no hay texto para copiar', 'error');
  try {
    await navigator.clipboard.writeText(text);
    ed().toast('Texto copiado al portapapeles', 'success');
  } catch {
    ed().toast('El navegador no permitió copiar: usa Descargar TXT', 'error');
  }
}

// ------------------------------------------------------------ auto-clean

export type CleanupKind = 'silence' | 'filler' | 'retake' | 'all';

const CLEANUP_LABEL: Record<CleanupKind, string> = {
  silence: 'Silencios',
  filler: 'Muletillas',
  retake: 'Tomas repetidas',
  all: 'Limpieza completa',
};

export function runCleanup(kind: CleanupKind) {
  const s = ed();
  const doc = s.doc;
  if (!doc?.clips.length) return s.toast('Añade un clip primero');
  const words = (c: MainClip) => wordsInClip(s.transcripts[c.mediaId], c);
  const needsTranscript = kind !== 'silence';
  if (needsTranscript && !doc.clips.some((c) => s.transcripts[c.mediaId]?.length))
    return s.toast('Necesitas la transcripción para esta limpieza', 'error');

  const before = sequenceDuration(buildSegments(doc.clips));
  let clips = doc.clips;
  let takes = 0;
  if (kind === 'filler' || kind === 'all') clips = clips.map((c) => replaceCuts(c, 'filler', computeFillerCuts(words(c), doc.settings.fillers)));
  if (kind === 'retake' || kind === 'all') {
    const base = clips.map((c) => replaceCuts(c, 'retake', []));
    const cw = buildClipWords({ clips: base, words: doc.words }, s.transcripts, buildSegments(base));
    const res = computeRetakeCuts(
      cw.map((x) => ({ clipId: x.clip.id, words: x.words, deleted: x.views.map((v) => v.deleted) })),
      doc.settings.fillers,
    );
    takes = res.takes;
    clips = base.map((c) => replaceCuts(c, 'retake', res.cuts.get(c.id) ?? []));
  }
  if (kind === 'silence' || kind === 'all') {
    clips = clips.map((c) =>
      replaceCuts(c, 'silence', computeSilenceCuts(c, words(c), s.envelopes[c.mediaId], doc.settings.silenceMin, doc.settings.silencePadding)),
    );
  }
  s.commitDoc((d) => ({ ...d, clips }));
  const after = sequenceDuration(buildSegments(clips));
  const saved = before - after;
  const extra = kind === 'retake' || kind === 'all' ? ` · ${takes} ${takes === 1 ? 'toma' : 'tomas'}` : '';
  s.toast(
    Math.abs(saved) < 0.05
      ? `${CLEANUP_LABEL[kind]}: no había nada que quitar${extra}`
      : `${CLEANUP_LABEL[kind]}: −${formatSeconds(saved)} (${formatTime(before, false)} → ${formatTime(after, false)})${extra}`,
    'success',
  );
}

export function clearCuts(reason: 'silence' | 'filler' | 'retake' | 'manual' | 'all') {
  ed().commitDoc((d) => ({ ...d, clips: d.clips.map((c) => ({ ...c, cuts: reason === 'all' ? [] : c.cuts.filter((x) => x.reason !== reason) })) }));
}

// --------------------------------------------------------------- media

const VIDEO_RE = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;
const RESOURCE_RE = /\.(mp4|mov|m4v|webm|mkv|avi|jpe?g|png|webp|mp3|wav|m4a|aac|ogg|flac|opus)$/i;

export async function uploadClips(files: File[]) {
  const valid = files.filter((f) => VIDEO_RE.test(f.name));
  if (valid.length < files.length) ed().toast('Solo se admiten vídeos (mp4, mov…) como clips principales', 'error');
  for (const file of valid) {
    const id = `${Date.now()}-${file.name}`;
    ed().setUpload({ id, name: file.name, progress: 0, error: null });
    try {
      const lang = ed().doc?.settings.language ?? 'es';
      const media = await uploadFile(`/api/media?name=${encodeURIComponent(file.name)}&lang=${lang}`, file, (p) =>
        ed().setUpload({ id, name: file.name, progress: p, error: null }),
      );
      ed().upsertMedia([media]);
      addClipInstance(media);
      ed().setUpload({ id, remove: true });
    } catch (e) {
      ed().setUpload({ id, remove: true });
      ed().toast(errorText(e), 'error');
    }
  }
}

export async function refreshResources() {
  try {
    const { dir, media } = await api.resources();
    ed().setResources(dir, media);
  } catch (e) {
    ed().toast(`No se pudo leer la carpeta de recursos: ${errorText(e)}`, 'error');
  }
}

export async function uploadResources(files: File[]) {
  for (const file of files.filter((f) => RESOURCE_RE.test(f.name))) {
    const id = `${Date.now()}-${file.name}`;
    ed().setUpload({ id, name: file.name, progress: 0, error: null });
    try {
      const media = await uploadFile(`/api/resources?name=${encodeURIComponent(file.name)}`, file, (p) =>
        ed().setUpload({ id, name: file.name, progress: p, error: null }),
      );
      ed().upsertMedia([media]);
    } catch (e) {
      ed().toast(errorText(e), 'error');
    } finally {
      ed().setUpload({ id, remove: true });
    }
  }
  await refreshResources();
}

export async function retranscribe(mediaId: string) {
  const lang = ed().doc?.settings.language ?? 'es';
  try {
    const media = await api.retranscribe(mediaId, lang);
    ed().upsertMedia([media]);
    ed().setTranscript(mediaId, null);
    // Overrides refer to the old word ids.
    ed().commit((d) => {
      for (const k of Object.keys(d.words)) if (k.startsWith(`${mediaId}:`)) delete d.words[k];
    });
  } catch (e) {
    ed().toast(errorText(e), 'error');
  }
}

export { wordKey };
