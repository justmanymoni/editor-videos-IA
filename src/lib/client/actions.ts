'use client';
/**
 * Editor commands used by buttons, keyboard shortcuts and the timeline.
 * They read the current state, apply pure edit functions and commit one
 * undoable step.
 */
import { nanoid } from 'nanoid';
import type { AudioItem, BrollItem, MainClip, MediaInfo, ProjectDoc, TextItem, WordOverride } from '@/lib/shared/types';
import { DEFAULT_TEXT, MAX_SPEED, MIN_SPEED, OUTPUT_HEIGHT, OUTPUT_WIDTH, wordKey } from '@/lib/shared/types';
import { FRAME, quantize } from '@/lib/shared/ranges';
import { buildClipWords, buildSegments, keptRanges, sequenceDuration, sourceToTimeline, timelineToSource, wordsInClip } from '@/lib/shared/timeline';
import { addCuts, moveRange, replaceCuts, restoreRanges, splitClip, splitItem, trimItemAt, trimRange, wordRunRanges } from '@/lib/shared/edit';
import { computeFillerCuts, computeRetakeCuts, computeSilenceCuts } from '@/lib/shared/cleanup';
import { alignScript } from '@/lib/shared/script';
import { splitTextBlocks } from '@/lib/shared/text';
import type { TextPreset } from '@/lib/shared/text-presets';
import { buildSrt, buildVtt, captionPages, transcriptText } from '@/lib/shared/text-export';
import { api, uploadFile } from './api';
import { currentDerived } from './derived';
import { formatSeconds, formatTime } from './format';
import { player, usePlayback } from './player';
import { selRefs, selectionOf, useEditor, type SelRef, type Selection } from './store';

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

/**
 * Rewrites the text of one subtitle block (edited in the player). The new
 * words are spread over the block's spoken words so the timing is kept:
 * extra words join the last one, and spoken words left without text are hidden.
 */
export function setSubtitleText(wordKeys: string[], text: string) {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const { clipWords } = currentDerived();
  const original = new Map(clipWords.flatMap((cw) => cw.views.map((v) => [v.key, v.word.text] as const)));
  ed().commit((d) => {
    wordKeys.forEach((key, i) => {
      const mine = i === wordKeys.length - 1 ? tokens.slice(i).join(' ') : (tokens[i] ?? '');
      const next: WordOverride = { ...d.words[key] };
      delete next.text;
      delete next.hidden;
      if (!mine) next.hidden = true;
      else if (mine !== original.get(key)) next.text = mine;
      if (Object.keys(next).length) d.words[key] = next;
      else delete d.words[key];
    });
  });
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

/** Tracks whose elements are placed freely in time. */
export type ItemKind = 'broll' | 'audio' | 'text';
type AnyItem = BrollItem | AudioItem | TextItem;
const LIST = { broll: 'broll', audio: 'audio', text: 'texts' } as const;
const ITEM_KINDS: ItemKind[] = ['text', 'broll', 'audio'];
const itemsOf = (doc: ProjectDoc, kind: ItemKind) => doc[LIST[kind]] as AnyItem[];
type ItemRef = { kind: ItemKind; id: string };
const isItemRef = (r: SelRef): r is ItemRef => r.kind === 'broll' || r.kind === 'audio' || r.kind === 'text';
const isItemSelection = (sel: Selection): sel is ItemRef => !!sel && sel.kind !== 'words' && sel.kind !== 'multi' && isItemRef(sel);

/** The free items (texts, overlays, audio) among some selected elements. */
export function pickItems(doc: ProjectDoc, refs: SelRef[]): { kind: ItemKind; item: AnyItem }[] {
  const out: { kind: ItemKind; item: AnyItem }[] = [];
  for (const r of refs) {
    const item = isItemRef(r) ? itemsOf(doc, r.kind).find((x) => x.id === r.id) : undefined;
    if (item && isItemRef(r)) out.push({ kind: r.kind, item });
  }
  return out;
}

const hasSegment = (refs: SelRef[], seg: { clipId: string; rangeIndex: number }) =>
  refs.some((r) => r.kind === 'segment' && r.clipId === seg.clipId && r.rangeIndex === seg.rangeIndex);

/** Everything on the timeline (Ctrl + A). */
export function selectAll() {
  const doc = ed().doc;
  if (!doc) return;
  const { segs, pages } = currentDerived();
  ed().setSelection(
    selectionOf([
      ...doc.texts.map((x): SelRef => ({ kind: 'text', id: x.id })),
      ...(doc.subtitles.enabled ? pages.map((p): SelRef => ({ kind: 'subtitle', page: p.index })) : []),
      ...doc.broll.map((x): SelRef => ({ kind: 'broll', id: x.id })),
      ...segs.map((x): SelRef => ({ kind: 'segment', clipId: x.clipId, rangeIndex: x.rangeIndex })),
      ...doc.audio.map((x): SelRef => ({ kind: 'audio', id: x.id })),
    ]),
  );
}

function replaceItem(kind: ItemKind, id: string, items: AnyItem[]) {
  ed().commitDoc((d) => {
    const list = itemsOf(d, kind);
    const i = list.findIndex((x) => x.id === id);
    return i < 0 ? d : { ...d, [LIST[kind]]: replaceAt(list, i, items) };
  });
}

export function splitAtPlayhead() {
  const s = ed();
  const doc = s.doc;
  if (!doc) return;
  const t = usePlayback.getState().time;
  const sel = s.selection;
  if (sel?.kind === 'multi') return splitSelected(sel.items, t);
  if (isItemSelection(sel)) {
    const item = itemsOf(doc, sel.kind).find((x) => x.id === sel.id);
    const parts = item ? splitItem(item, t, newId) : null;
    if (!parts) return s.toast('Coloca el cursor dentro del elemento seleccionado para dividirlo');
    replaceItem(sel.kind, sel.id, parts);
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

/** Splits at the playhead every selected element that it crosses, as one undo step. */
function splitSelected(refs: SelRef[], t: number) {
  const s = ed();
  const loc = timelineToSource(currentDerived().segs, t);
  let done = 0;
  s.commitDoc((d) => {
    let next = d;
    for (const kind of ITEM_KINDS) {
      const ids = new Set(refs.filter((r) => r.kind === kind).map((r) => (r as ItemRef).id));
      if (!ids.size) continue;
      const list = itemsOf(next, kind).flatMap((item) => {
        const parts = ids.has(item.id) ? splitItem(item, t, newId) : null;
        if (parts) done++;
        return parts ?? [item];
      });
      next = { ...next, [LIST[kind]]: list };
    }
    if (loc && hasSegment(refs, loc.seg)) {
      const parts = splitClip(next.clips[loc.seg.clipIndex], quantize(loc.src), newId);
      if (parts) {
        done++;
        next = { ...next, clips: replaceAt(next.clips, loc.seg.clipIndex, parts) };
      }
    }
    return done ? next : d;
  });
  if (!done) return s.toast('Coloca el cursor sobre alguno de los elementos seleccionados para dividirlo');
  s.setSelection(selectionOf(refs.filter(isItemRef)));
}

/** "Delete left / right" on every selected element that the playhead crosses, as one undo step. */
function trimSelected(refs: SelRef[], t: number, side: 'left' | 'right') {
  const s = ed();
  const key = `trim:${Date.now()}`;
  const loc = timelineToSource(currentDerived().segs, t);
  let done = 0;
  s.commitDoc((d) => {
    let next = d;
    for (const kind of ITEM_KINDS) {
      const ids = new Set(refs.filter((r) => r.kind === kind).map((r) => (r as ItemRef).id));
      if (!ids.size) continue;
      const list = itemsOf(next, kind).map((item) => {
        const trimmed = ids.has(item.id) ? trimItemAt(item, t, side) : null;
        if (trimmed) done++;
        return trimmed ?? item;
      });
      next = { ...next, [LIST[kind]]: list };
    }
    return done ? next : d;
  }, key);
  if (loc && hasSegment(refs, loc.seg)) {
    const { seg, src } = loc;
    const room = side === 'left' ? src - seg.srcStart : seg.srcEnd - src;
    if (room >= FRAME) {
      done++;
      trimSegment(seg.clipId, seg.rangeIndex, side === 'left' ? 'start' : 'end', src, key);
      if (side === 'left') player.seek(seg.tlStart);
    }
  }
  if (!done) s.toast('Coloca el cursor sobre alguno de los elementos seleccionados');
}

/**
 * "Delete left / right" as in CapCut: removes what is before or after the
 * playhead in the selected element, or in the main clip under the playhead.
 */
export function trimAtPlayhead(side: 'left' | 'right') {
  const s = ed();
  const doc = s.doc;
  if (!doc) return;
  const t = usePlayback.getState().time;
  const sel = s.selection;
  if (sel?.kind === 'multi') return trimSelected(sel.items, t, side);
  if (isItemSelection(sel)) {
    const item = itemsOf(doc, sel.kind).find((x) => x.id === sel.id);
    const trimmed = item ? trimItemAt(item, t, side) : null;
    if (!trimmed) return s.toast('Coloca el cursor dentro del elemento seleccionado');
    replaceItem(sel.kind, sel.id, [trimmed]);
    return;
  }
  const loc = timelineToSource(currentDerived().segs, t);
  if (!loc) return;
  const { seg, src } = loc;
  if (side === 'left') {
    if (src - seg.srcStart < FRAME) return s.toast('No hay nada a la izquierda del cursor en este clip');
    trimSegment(seg.clipId, seg.rangeIndex, 'start', src);
    player.seek(seg.tlStart);
  } else {
    if (seg.srcEnd - src < FRAME) return s.toast('No hay nada a la derecha del cursor en este clip');
    trimSegment(seg.clipId, seg.rangeIndex, 'end', src);
  }
}

export function deleteSelection() {
  const s = ed();
  const sel = s.selection;
  if (!sel || !s.doc) return;
  if (sel.kind === 'words') return cutSelectedWords();
  if (sel.kind === 'multi') return deleteMany(sel.items);
  if (isItemSelection(sel)) {
    s.commitDoc((d) => ({ ...d, [LIST[sel.kind]]: itemsOf(d, sel.kind).filter((x) => x.id !== sel.id) }));
  } else if (sel.kind === 'segment') {
    s.commitDoc((d) => ({
      ...d,
      clips: d.clips.map((c) => {
        if (c.id !== sel.clipId) return c;
        const r = keptRanges(c)[sel.rangeIndex];
        return r ? addCuts(c, [r], 'manual') : c;
      }),
    }));
  } else if (sel.kind === 'subtitle') {
    const page = currentDerived().pages[sel.page];
    if (page)
      patchWords(
        page.words.map((w) => w.key),
        (prev) => ({ ...prev, hidden: true }),
      );
  }
  s.setSelection(null);
}

/** Deletes several elements of any kind as one undo step. */
function deleteMany(refs: SelRef[]) {
  const s = ed();
  const key = `delete:${Date.now()}`;
  // Subtitle blocks are numbered on the current timeline: read their words before anything changes.
  const { pages } = currentDerived();
  const subtitleWords = refs.flatMap((r) => (r.kind === 'subtitle' ? (pages[r.page]?.words.map((w) => w.key) ?? []) : []));
  const ranges = new Map<string, number[]>();
  for (const r of refs) if (r.kind === 'segment') ranges.set(r.clipId, [...(ranges.get(r.clipId) ?? []), r.rangeIndex]);
  s.commitDoc((d) => {
    let next = d;
    for (const kind of ITEM_KINDS) {
      const ids = new Set(refs.filter((r) => r.kind === kind).map((r) => (r as ItemRef).id));
      if (ids.size) next = { ...next, [LIST[kind]]: itemsOf(next, kind).filter((x) => !ids.has(x.id)) };
    }
    if (ranges.size) {
      next = {
        ...next,
        clips: next.clips.map((c) => {
          const kept = keptRanges(c);
          const cut = (ranges.get(c.id) ?? []).map((i) => kept[i]).filter(Boolean);
          return cut.length ? addCuts(c, cut, 'manual') : c;
        }),
      };
    }
    return next;
  }, key);
  patchWords(subtitleWords, (prev) => ({ ...prev, hidden: true }), key);
  s.setSelection(null);
}

/** Longest a clip can be extended: its file length, or an hour for photos. */
const sourceLength = (m: MediaInfo | undefined, fallback: number) => (m?.kind === 'image' ? 3600 : (m?.duration ?? fallback));

export function trimSegment(clipId: string, rangeIndex: number, edge: 'start' | 'end', src: number, coalesceKey?: string) {
  const s = ed();
  s.commitDoc(
    (d) => ({
      ...d,
      clips: d.clips.map((c) => (c.id === clipId ? trimRange(c, rangeIndex, edge, quantize(src), sourceLength(s.media[c.mediaId], c.end)) : c)),
    }),
    coalesceKey,
  );
}

/**
 * Sets the playback speed of some clips (or of every clip when `clipIds` is
 * null). Photos have no speed: their length is changed by dragging their edge.
 */
export function setClipSpeed(clipIds: string[] | null, speed: number, coalesceKey?: string) {
  const s = ed();
  const value = Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(speed * 100) / 100));
  s.commit((d) => {
    for (const c of d.clips) {
      if (clipIds && !clipIds.includes(c.id)) continue;
      if (s.media[c.mediaId]?.kind === 'image') continue;
      if (value === 1) delete c.speed;
      else c.speed = value;
    }
  }, coalesceKey);
}

export function moveSegment(clipId: string, rangeIndex: number, dropTime: number) {
  ed().commitDoc((d) => ({ ...d, clips: moveRange(d.clips, clipId, rangeIndex, dropTime, newId) }));
  ed().setSelection(null);
}

export type ItemPatch = Partial<BrollItem & AudioItem & TextItem>;

export function updateItem(kind: ItemKind, id: string, patch: ItemPatch, coalesceKey?: string) {
  updateItems([{ kind, id, patch }], coalesceKey);
}

/** Changes several items in one undo step. */
export function updateItems(changes: { kind: ItemKind; id: string; patch: ItemPatch }[], coalesceKey?: string) {
  if (!changes.length) return;
  ed().commit((d) => {
    for (const c of changes) {
      const item = itemsOf(d as ProjectDoc, c.kind).find((x) => x.id === c.id);
      if (item) Object.assign(item, c.patch);
    }
  }, coalesceKey);
}

/** Moves the selected texts, overlays and audio together along the timeline. */
export function moveItems(refs: SelRef[], dt: number) {
  const doc = ed().doc;
  const items = doc ? pickItems(doc, refs) : [];
  if (!items.length || !dt) return;
  const shift = Math.max(dt, -Math.min(...items.map((x) => x.item.start)));
  updateItems(items.map(({ kind, item }) => ({ kind, id: item.id, patch: { start: item.start + shift } })));
}

/**
 * Gives the same duration to every selected item. Items that were one right
 * after another on a track stay that way, so a row of text blocks does not
 * end up with gaps or overlaps.
 */
export function setItemsDuration(refs: SelRef[], duration: number, coalesceKey?: string) {
  const s = ed();
  if (!s.doc) return;
  const picked = pickItems(s.doc, refs);
  const changes: { kind: ItemKind; id: string; patch: ItemPatch }[] = [];
  for (const kind of ITEM_KINDS) {
    const items = picked.filter((x) => x.kind === kind).map((x) => x.item);
    items.sort((a, b) => a.start - b.start);
    let oldEnd = -Infinity;
    let newEnd = 0;
    for (const item of items) {
      const m = 'mediaId' in item ? s.media[item.mediaId] : undefined;
      const room = m && m.kind !== 'image' && 'srcIn' in item ? Math.max(0.1, m.duration - item.srcIn) : Infinity;
      const start = Math.abs(item.start - oldEnd) < 0.05 ? newEnd : item.start;
      const length = Math.max(0.1, Math.min(duration, room));
      changes.push({ kind, id: item.id, patch: { start, duration: length } });
      oldEnd = item.start + item.duration;
      newEnd = start + length;
    }
  }
  updateItems(changes, coalesceKey);
}

const withMedia = (doc: ProjectDoc, id: string): string[] => (doc.media.includes(id) ? doc.media : [...doc.media, id]);

/** How long a photo lasts when it is added to the main track. */
const STILL_SECONDS = 5;

/**
 * Adds a video or a photo to the main track: between the clips nearest to
 * `dropTime`, or at the end. Videos that were never transcribed are transcribed.
 */
export function insertClip(media: MediaInfo, dropTime?: number) {
  if (media.kind === 'audio') return addAudio(media, dropTime ?? usePlayback.getState().time);
  ed().commitDoc((d) => {
    const clip: MainClip = {
      id: newId(),
      mediaId: media.id,
      start: 0,
      end: media.kind === 'image' ? STILL_SECONDS : media.duration,
      cuts: [],
      autoClean: (media.kind === 'video' && d.settings.autoSilence) || undefined,
    };
    let index = d.clips.length;
    if (dropTime !== undefined) {
      const segs = buildSegments(d.clips);
      index = 0;
      d.clips.forEach((c, i) => {
        const own = segs.filter((x) => x.clipId === c.id);
        if (own.length && (own[0].tlStart + own[own.length - 1].tlEnd) / 2 < dropTime) index = i + 1;
      });
    }
    return { ...d, media: withMedia(d, media.id), clips: [...d.clips.slice(0, index), clip, ...d.clips.slice(index)] };
  });
  if (media.kind === 'video' && media.hasAudio && media.transcript.status === 'none') void retranscribe(media.id);
}

export const addClipInstance = (media: MediaInfo) => insertClip(media);

/** The "+" of the media panel: after the clip under the playhead (or at the end), audio at the playhead. */
export function addToTimeline(media: MediaInfo) {
  const { time, duration } = usePlayback.getState();
  if (media.kind === 'audio') return addAudio(media, time);
  if (time < 0.05 || time > duration - 0.05) return insertClip(media);
  const loc = timelineToSource(currentDerived().segs, time);
  const clipId = loc?.seg.clipId;
  const spanEnd = currentDerived()
    .segs.filter((x) => x.clipId === clipId)
    .reduce((m, x) => Math.max(m, x.tlEnd), 0);
  insertClip(media, spanEnd + FRAME);
}

/** Keeps a media file in the project's panel without placing it on the timeline. */
export function addToBin(media: MediaInfo) {
  ed().commitDoc((d) => (d.media.includes(media.id) ? d : { ...d, media: [...d.media, media.id] }));
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
  // Stickers and logos (transparent images) start small, about 45 % of the frame width.
  if (media.hasAlpha && media.width > 0) item.scale = (0.45 * OUTPUT_WIDTH) / Math.max(OUTPUT_WIDTH, (OUTPUT_HEIGHT * media.width) / media.height);
  ed().commitDoc((d) => ({ ...d, media: withMedia(d, media.id), broll: [...d.broll, item] }));
  ed().setSelection({ kind: 'broll', id: item.id });
}

export function addAudio(media: MediaInfo, start: number, opts: Partial<AudioItem> = {}) {
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
    ...opts,
  };
  ed().commitDoc((d) => ({ ...d, media: withMedia(d, media.id), audio: [...d.audio, item] }));
  ed().setSelection({ kind: 'audio', id: item.id });
}

export function removeMediaFromProject(mediaId: string) {
  ed().commitDoc((d) => {
    const { [mediaId]: _mix, ...audioMix } = d.audioMix;
    return {
      ...d,
      media: d.media.filter((m) => m !== mediaId),
      clips: d.clips.filter((c) => c.mediaId !== mediaId),
      broll: d.broll.filter((b) => b.mediaId !== mediaId),
      audio: d.audio.filter((a) => a.mediaId !== mediaId),
      audioMix,
    };
  });
  ed().setSelection(null);
}

export function stepFrames(frames: number) {
  player.pause();
  player.seek(usePlayback.getState().time + frames * FRAME);
}

// ---------------------------------------------------------- manual texts

/** Reading time for a text block: about 0.45 s per word. */
export const textDuration = (text: string) => Math.max(1.2, Math.min(8, text.trim().split(/\s+/).filter(Boolean).length * 0.45 + 0.6));

/**
 * Adds typed or dictated text at the playhead. Slashes separate blocks:
 * "el lobo / enfurecido / está en el bosque" becomes three texts in a row.
 * With `wordsPerBlock` the text is also cut every so many words.
 */
export function addTextBlocks(raw: string, style: Partial<TextItem> = {}, wordsPerBlock = 0) {
  const blocks = splitTextBlocks(raw, wordsPerBlock);
  if (!blocks.length) return ed().toast('Escribe o dicta un texto primero');
  let t = usePlayback.getState().time;
  const items = blocks.map((text): TextItem => {
    const item = { ...DEFAULT_TEXT, ...style, id: newId(), text, start: t, duration: textDuration(text) };
    t += item.duration;
    return item;
  });
  ed().commitDoc((d) => ({ ...d, texts: [...d.texts, ...items] }));
  // All the new blocks stay selected, so their look can be changed at once.
  ed().setSelection(selectionOf(items.map((x): SelRef => ({ kind: 'text', id: x.id }))));
  if (items.length > 1) ed().toast(`${items.length} bloques de texto añadidos y seleccionados`, 'success');
}

/** Adds a ready-made text (title, label, boxed keyword…) at the playhead and selects it. */
export function addTextPreset(preset: TextPreset) {
  const item: TextItem = {
    ...DEFAULT_TEXT,
    ...preset.style,
    id: newId(),
    text: preset.sample,
    start: usePlayback.getState().time,
    duration: Math.max(2, textDuration(preset.sample)),
  };
  ed().commitDoc((d) => ({ ...d, texts: [...d.texts, item] }));
  ed().setSelection({ kind: 'text', id: item.id });
}

/** Gives the look and animation of a preset to the selected texts, keeping their wording, place and timing. */
export function applyTextPreset(preset: TextPreset) {
  const s = ed();
  const texts = s.doc ? pickItems(s.doc, selRefs(s.selection)).filter((x) => x.kind === 'text') : [];
  if (!texts.length) return s.toast('Selecciona antes un texto');
  const { x: _x, y: _y, ...look } = { ...DEFAULT_TEXT, ...preset.style };
  const { text: _text, ...patch } = look;
  updateItems(texts.map(({ item }) => ({ kind: 'text' as const, id: item.id, patch })));
}

/** Splits one text containing slashes into consecutive texts that share its time span. */
export function splitTextBySlashes(id: string) {
  const item = ed().doc?.texts.find((x) => x.id === id);
  if (!item) return;
  const blocks = splitTextBlocks(item.text);
  if (blocks.length < 2) return ed().toast('Escribe una barra / donde quieras cortar el texto');
  const chars = blocks.reduce((n, b) => n + b.length, 0);
  let t = item.start;
  const parts = blocks.map((text, i): TextItem => {
    const part = { ...item, id: i === 0 ? item.id : newId(), text, start: t, duration: (item.duration * text.length) / chars };
    t += part.duration;
    return part;
  });
  replaceItem('text', id, parts);
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
      // Slashes in the script decide where each subtitle block starts.
      if (res.hasBreaks) {
        if (res.breaks.includes(i)) next.breakBefore = true;
        else delete next.breakBefore;
      }
      if (Object.keys(next).length) d.words[v.key] = next;
      else delete d.words[v.key];
    });
  });
  const extra = res.extraSpoken ? ` · ${res.extraSpoken} palabras dichas que no están en el guión (se mantienen)` : '';
  const blocks = res.hasBreaks ? ` · ${res.breaks.length + 1} bloques de subtítulos por tus barras /` : '';
  s.toast(`Guión aplicado: ${res.matched} palabras coinciden, ${res.changed} corregidas${blocks}${extra}`, 'success');
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
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const AUDIO_RE = /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i;
const RESOURCE_RE = /\.(mp4|mov|m4v|webm|mkv|avi|jpe?g|png|webp|mp3|wav|m4a|aac|ogg|flac|opus)$/i;

/**
 * Imports files into the project. Videos go straight to the end of the main
 * track (and are transcribed); photos stay in the panel until they are added
 * with "+" or dragged; audio goes to the resources folder.
 */
export async function uploadClips(files: File[]) {
  const audio = files.filter((f) => AUDIO_RE.test(f.name));
  const visual = files.filter((f) => VIDEO_RE.test(f.name) || IMAGE_RE.test(f.name));
  if (audio.length + visual.length < files.length)
    ed().toast('Formato no admitido. Usa vídeo (mp4, mov), foto (jpg, png) o audio (mp3, wav, m4a)', 'error');
  for (const file of visual) {
    const id = `${Date.now()}-${file.name}`;
    ed().setUpload({ id, name: file.name, progress: 0, error: null });
    try {
      const lang = ed().doc?.settings.language ?? 'es';
      const media = await uploadFile(`/api/media?name=${encodeURIComponent(file.name)}&lang=${lang}`, file, (p) =>
        ed().setUpload({ id, name: file.name, progress: p, error: null }),
      );
      ed().upsertMedia([media]);
      if (media.kind === 'video') insertClip(media);
      else addToBin(media);
    } catch (e) {
      ed().toast(errorText(e), 'error');
    } finally {
      ed().setUpload({ id, remove: true });
    }
  }
  if (audio.length) await uploadResources(audio);
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

/** Speech to text with the local engine: returns what was said in a microphone recording. */
export async function dictate(recording: Blob): Promise<string | null> {
  const lang = ed().doc?.settings.language ?? 'es';
  try {
    return (await api.dictate(recording, lang)).trim();
  } catch (e) {
    ed().toast(`No se pudo transcribir tu voz: ${errorText(e)}`, 'error');
    return null;
  }
}

/** Saves a microphone recording as audio and places it on the audio track at the playhead. */
export async function addVoiceRecording(recording: Blob) {
  try {
    const media = await api.record(recording);
    ed().upsertMedia([media]);
    addAudio(media, usePlayback.getState().time, { duration: media.duration, volume: 1, fadeIn: 0, fadeOut: 0 });
    void refreshResources();
    ed().toast('Tu grabación está en la pista de audio', 'success');
  } catch (e) {
    ed().toast(`No se pudo guardar la grabación: ${errorText(e)}`, 'error');
  }
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
