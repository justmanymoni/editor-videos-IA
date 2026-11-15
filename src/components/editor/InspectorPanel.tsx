'use client';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Captions, FileText, SlidersHorizontal } from 'lucide-react';
import { useEditor } from '@/lib/client/store';
import { TranscriptPanel } from './TranscriptPanel';
import { SubtitleStylePanel } from './SubtitleStylePanel';
import { Properties } from './Properties';

type Tab = 'transcript' | 'subtitles' | 'props';

const TABS = [
  ['subtitles', 'Subtítulos', Captions],
  ['props', 'Propiedades', SlidersHorizontal],
  ['transcript', 'Transcripción', FileText],
] as const;

/** Right-hand panel: transcript, subtitle style and the properties of the selected element. */
export function InspectorPanel() {
  const [tab, setTab] = useState<Tab>('subtitles');
  const kind = useEditor((s) => s.selection?.kind);
  const id = useEditor((s) => (s.selection && 'id' in s.selection ? s.selection.id : null));

  // Selecting an element shows its settings, as in CapCut.
  useEffect(() => {
    if (kind === 'text' || kind === 'broll' || kind === 'audio') setTab('props');
    else if (kind === 'subtitle') setTab('subtitles');
  }, [kind, id]);

  return (
    <aside className="flex h-full min-w-0 flex-col bg-panel">
      <div className="flex shrink-0 border-b border-line px-2 pt-2">
        {TABS.map(([value, label, Icon]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            onMouseUp={(e) => e.currentTarget.blur()}
            className={clsx(
              'flex flex-1 items-center justify-center gap-1.5 border-b-2 px-1 pb-2 text-xs font-semibold whitespace-nowrap transition-colors',
              tab === value ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'transcript' ? <TranscriptPanel /> : tab === 'subtitles' ? <SubtitleStylePanel /> : <Properties />}
      </div>
    </aside>
  );
}
