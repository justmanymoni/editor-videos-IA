'use client';
import { useState } from 'react';
import clsx from 'clsx';
import { Captions, FileText } from 'lucide-react';
import { TranscriptPanel } from './TranscriptPanel';
import { SubtitleStylePanel } from './SubtitleStylePanel';

export function SidePanel() {
  const [tab, setTab] = useState<'transcript' | 'style'>('transcript');
  return (
    <aside className="flex w-[400px] shrink-0 flex-col border-l border-line bg-panel">
      <div className="flex border-b border-line px-2 pt-2">
        {(
          [
            ['transcript', 'Transcripción', FileText],
            ['style', 'Estilo de subtítulos', Captions],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            onMouseUp={(e) => e.currentTarget.blur()}
            className={clsx(
              'flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 pb-2 text-xs font-semibold transition-colors',
              tab === id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">{tab === 'transcript' ? <TranscriptPanel /> : <SubtitleStylePanel />}</div>
    </aside>
  );
}
