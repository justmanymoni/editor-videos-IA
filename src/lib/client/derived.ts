'use client';
/**
 * Derived data shared by several panels, memoised on input identity so the
 * preview, transcript, timeline and subtitle overlay reuse the same result.
 */
import { useEditor } from './store';
import type { MainClip, ProjectDoc, SubtitleStyle, Word } from '@/lib/shared/types';
import { buildClipWords, buildSegments, type ClipWords, type Segment } from '@/lib/shared/timeline';
import { buildPages, collectSubWords, type SubPage } from '@/lib/shared/subtitles';

function memo1<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let lastArgs: A | null = null;
  let last: R;
  return (...args: A) => {
    if (lastArgs && args.length === lastArgs.length && args.every((a, i) => a === lastArgs![i])) return last;
    lastArgs = args;
    last = fn(...args);
    return last;
  };
}

const EMPTY_CLIPS: MainClip[] = [];

export const selectSegments = memo1((clips: MainClip[]): Segment[] => buildSegments(clips));

export const selectClipWords = memo1((clips: MainClip[], words: ProjectDoc['words'], transcripts: Record<string, Word[]>): ClipWords[] =>
  buildClipWords({ clips, words }, transcripts, selectSegments(clips)),
);

export const selectPages = memo1((clipWords: ClipWords[], style: SubtitleStyle): SubPage[] => buildPages(collectSubWords(clipWords, style), style));

export function useSegments(): Segment[] {
  const clips = useEditor((s) => s.doc?.clips ?? EMPTY_CLIPS);
  return selectSegments(clips);
}

export function useClipWords(): ClipWords[] {
  const clips = useEditor((s) => s.doc?.clips ?? EMPTY_CLIPS);
  const words = useEditor((s) => s.doc?.words);
  const transcripts = useEditor((s) => s.transcripts);
  return selectClipWords(clips, words ?? {}, transcripts);
}

export function useSubtitlePages(): SubPage[] {
  const clipWords = useClipWords();
  const style = useEditor((s) => s.doc?.subtitles);
  return style ? selectPages(clipWords, style) : [];
}

/** Current state, outside React (event handlers, keyboard shortcuts). */
export function currentDerived() {
  const s = useEditor.getState();
  const clips = s.doc?.clips ?? EMPTY_CLIPS;
  const segs = selectSegments(clips);
  const clipWords = selectClipWords(clips, s.doc?.words ?? {}, s.transcripts);
  const pages = s.doc ? selectPages(clipWords, s.doc.subtitles) : [];
  return { segs, clipWords, pages };
}
