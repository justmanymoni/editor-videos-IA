'use client';
import { useEffect } from 'react';
import clsx from 'clsx';
import { useEditor, type InspectorTab } from '@/lib/client/store';
import { SubtitleStylePanel } from './SubtitleStylePanel';
import { Properties } from './Properties';
import { AudioPanel } from './AudioPanel';
import { AnimationPanel } from './AnimationPanel';
import { SpeedPanel } from './SpeedPanel';
import { SmartPanel } from './SmartPanel';

/** Right-hand panel, as in CapCut: one tab per kind of setting. */
export function InspectorPanel() {
  const tab = useEditor((s) => s.inspectorTab);
  const kind = useEditor((s) => s.selection?.kind);
  const id = useEditor((s) => (s.selection && 'id' in s.selection ? s.selection.id : null));

  // Selecting an element shows its settings.
  useEffect(() => {
    const next: InspectorTab | null =
      kind === 'text' || kind === 'broll' || kind === 'multi' || kind === 'segment'
        ? 'video'
        : kind === 'audio'
          ? 'audio'
          : kind === 'subtitle'
            ? 'subtitles'
            : null;
    if (next) useEditor.getState().set({ inspectorTab: next });
  }, [kind, id]);

  const tabs: [InspectorTab, string][] = [
    ['video', kind === 'text' ? 'Texto' : kind === 'multi' ? 'Selección' : 'Vídeo'],
    ['audio', 'Audio'],
    ['subtitles', 'Subtítulos'],
    ['animation', 'Animación'],
    ['speed', 'Velocidad'],
    ['smart', 'Inteligente'],
  ];

  return (
    <aside className="flex h-full min-w-0 flex-col bg-panel">
      <div className="flex shrink-0 gap-4 overflow-x-auto border-b border-line px-3.5">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            data-inspector-tab={value}
            onClick={() => useEditor.getState().set({ inspectorTab: value })}
            onMouseUp={(e) => e.currentTarget.blur()}
            className={clsx(
              'shrink-0 border-b-2 pt-2.5 pb-2 text-xs font-semibold whitespace-nowrap transition-colors',
              tab === value ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'video' ? (
          <Properties />
        ) : tab === 'audio' ? (
          <AudioPanel />
        ) : tab === 'subtitles' ? (
          <SubtitleStylePanel />
        ) : tab === 'animation' ? (
          <AnimationPanel />
        ) : tab === 'speed' ? (
          <SpeedPanel />
        ) : (
          <SmartPanel />
        )}
      </div>
    </aside>
  );
}
