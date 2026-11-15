'use client';
import clsx from 'clsx';
import type { MediaInfo } from '@/lib/shared/types';
import { useEditor } from '@/lib/client/store';
import { Section, SliderRow } from '@/components/ui';
import { AudioProps } from './Properties';
import { AudioControls } from './ToolsPanel';

/**
 * Audio tab: the volume of the original sound, the voice / music mix of each
 * video of the project and, when a music or voice clip is selected, its settings.
 */
export function AudioPanel() {
  const doc = useEditor((s) => s.doc)!;
  const media = useEditor((s) => s.media);
  const sel = useEditor((s) => s.selection);
  const commit = useEditor((s) => s.commit);
  const audio = sel?.kind === 'audio' ? doc.audio.find((x) => x.id === sel.id) : undefined;
  const selectedMedia = sel?.kind === 'segment' ? doc.clips.find((c) => c.id === sel.clipId)?.mediaId : undefined;
  const videos = [...new Set(doc.clips.map((c) => c.mediaId))]
    .map((id) => media[id])
    .filter((m): m is MediaInfo => !!m && m.kind === 'video' && m.hasAudio && m.status !== 'error');
  // The video of the selected clip goes first.
  videos.sort((a, b) => Number(b.id === selectedMedia) - Number(a.id === selectedMedia));

  return (
    <div className="h-full overflow-y-auto">
      {audio && <AudioProps item={audio} />}
      <Section title="Sonido de los vídeos">
        <SliderRow
          label="Volumen"
          value={doc.settings.mainVolume}
          min={0}
          max={1}
          step={0.05}
          scale={100}
          unit="%"
          onChange={(v) => commit((d) => void (d.settings.mainVolume = v), 'mainVolume')}
        />
      </Section>
      {videos.map((m) => (
        <Section key={m.id} title="Voz y música">
          <p className={clsx('truncate text-xs', m.id === selectedMedia ? 'text-accent' : 'text-muted')} title={m.name}>
            {m.name}
          </p>
          <AudioControls media={m} />
        </Section>
      ))}
      {!videos.length && !audio && (
        <p className="px-3.5 py-3 text-[11px] leading-relaxed text-faint">
          Cuando añadas un vídeo con sonido, aquí podrás separar su voz de la música y elegir el volumen de cada una.
        </p>
      )}
    </div>
  );
}
