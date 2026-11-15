'use client';
import { useCallback, useEffect, useState } from 'react';

/**
 * Editor layout chosen by the user (kept in this browser). Panel widths are
 * null while "automatic": the player column hugs the video and the two panels
 * share the rest of the window.
 */
export interface Layout {
  /** Where the player sits: between the panels, or at the right. */
  player: 'center' | 'right';
  toolsW: number | null;
  /** Right panel, when the player is in the centre. */
  sideW: number | null;
  /** Player column, when the player is at the right. */
  playerW: number | null;
  timelineH: number;
}

export const DEFAULT_LAYOUT: Layout = { player: 'center', toolsW: null, sideW: null, playerW: null, timelineH: 300 };
const KEY = 'verticut.layout';

export function useLayout() {
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Layout> | null;
      if (saved) setLayout({ ...DEFAULT_LAYOUT, ...saved });
    } catch {
      // Ignore a corrupt preference.
    }
  }, []);

  const update = useCallback((patch: Partial<Layout>) => {
    setLayout((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Private mode: the layout just is not remembered.
      }
      return next;
    });
  }, []);

  return [layout, update] as const;
}
