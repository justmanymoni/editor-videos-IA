'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Loader2, Pause, Play, SkipBack, SkipForward, Upload } from 'lucide-react';
import type { MediaInfo } from '@/lib/shared/types';
import { OUTPUT_HEIGHT, OUTPUT_WIDTH } from '@/lib/shared/types';
import { overlayRect } from '@/lib/shared/text-curve';
import { mediaUrl } from '@/lib/client/api';
import { useEditor } from '@/lib/client/store';
import { useSegments, useSubtitlePages } from '@/lib/client/derived';
import { deckKey, player, usePlayback } from '@/lib/client/player';
import { useKeyedRefs } from '@/lib/client/hooks';
import { formatTime } from '@/lib/client/format';
import { uploadClips } from '@/lib/client/actions';
import { IconButton } from '@/components/ui';
import { SubtitleOverlay } from './SubtitleOverlay';
import { StageItems, useStageGestures } from './StageItems';

/** Space around the video inside the player column, and height of its controls. */
export const PLAYER_PADDING = 10;
export const PLAYER_CONTROLS = 44;

function useFitBox(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 270, h: 480 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      const h = Math.max(120, Math.min(height - 2 * PLAYER_PADDING, ((width - 2 * PLAYER_PADDING) * 16) / 9));
      setSize({ w: (h * 9) / 16, h });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

function TimeDisplay() {
  const time = usePlayback((s) => s.time);
  const duration = usePlayback((s) => s.duration);
  return (
    <span className="font-mono text-xs whitespace-nowrap text-muted tabular-nums">
      <span className="text-fg">{formatTime(time)}</span> / {formatTime(duration)}
    </span>
  );
}

export function Preview() {
  const doc = useEditor((s) => s.doc)!;
  const media = useEditor((s) => s.media);
  const mixUrls = useEditor((s) => s.mixUrls);
  const segs = useSegments();
  const pages = useSubtitlePages();
  const playing = usePlayback((s) => s.playing);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { w, h } = useFitBox(boxRef);
  const scale = w / OUTPUT_WIDTH;
  const blur = doc.settings.fitMode === 'blur';
  const { begin, guides } = useStageGestures();

  const deckRef = useKeyedRefs(useCallback((key: string, el: HTMLVideoElement | HTMLImageElement | null) => player.registerDeck(key, el), []));
  const overlayRef = useKeyedRefs(useCallback((key: string, el: HTMLVideoElement | HTMLImageElement | null) => player.registerOverlay(key, el), []));
  const audioRef = useKeyedRefs(useCallback((key: string, el: HTMLAudioElement | null) => player.registerAudio(key, el), []));

  useEffect(() => {
    player.setTimeline(segs, doc.broll, doc.audio, doc.settings.mainVolume);
  }, [segs, doc.broll, doc.audio, doc.settings.mainVolume]);

  useEffect(() => {
    player.setBlurCanvas(canvasRef.current, blur);
  }, [blur]);

  useEffect(() => () => player.pause(), []);

  const mainMedia = [...new Set(doc.clips.map((c) => c.mediaId))].map((id) => media[id]).filter((m): m is MediaInfo => !!m);
  const preparing = mainMedia.find((m) => m.status === 'processing' && m.stage?.startsWith('Optimizando'));
  const deckStyle = { objectFit: blur ? 'contain' : 'cover', opacity: 0 } as const;

  return (
    <section className="flex h-full min-w-0 flex-col bg-[#060607]">
      <div ref={boxRef} className="relative flex min-h-0 flex-1 items-center justify-center">
        <div className="relative overflow-hidden rounded-md bg-black ring-1 ring-line" style={{ width: w, height: h }}>
          <div
            data-stage
            className="absolute top-0 left-0 origin-top-left"
            style={{ width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT, transform: `scale(${scale})` }}
            onPointerDown={() => useEditor.getState().setSelection(null)}
          >
            <canvas
              ref={canvasRef}
              width={54}
              height={96}
              className={clsx('absolute inset-0 h-full w-full', !blur && 'hidden')}
              style={{ filter: 'blur(28px) brightness(0.8)', transform: 'scale(1.12)' }}
            />
            {mainMedia.map((m) =>
              m.kind === 'image' ? (
                <img
                  key={m.id}
                  ref={deckRef(deckKey(m.id, 0))}
                  src={`/api/media/${m.id}/file`}
                  alt=""
                  className="absolute inset-0 h-full w-full"
                  style={deckStyle}
                />
              ) : (
                [0, 1].map((slot) => (
                  <video
                    key={`${m.id}-${slot}`}
                    ref={deckRef(deckKey(m.id, slot))}
                    src={(doc.audioMix[m.id] && mixUrls[m.id]) || mediaUrl.preview(m)}
                    preload="auto"
                    playsInline
                    className="absolute inset-0 h-full w-full"
                    style={deckStyle}
                  />
                ))
              ),
            )}
            {doc.broll.map((b) => {
              const m = media[b.mediaId];
              if (!m) return null;
              // Same geometry as the export: covers the frame at scale 1, free position and size otherwise.
              const rect = overlayRect(m.width, m.height, OUTPUT_WIDTH, OUTPUT_HEIGHT, b.x, b.y, b.scale);
              const props = {
                ref: overlayRef(b.id),
                'data-overlay': b.id,
                onPointerDown: (e: React.PointerEvent) => begin(e, 'move', { kind: 'broll', item: b }),
                className: 'absolute max-w-none cursor-move',
                style: { ...rect, opacity: 0, pointerEvents: 'none' } as const,
                draggable: false,
              };
              return m.kind === 'image' ? (
                <img key={b.id} {...props} src={`/api/media/${m.id}/file`} alt="" />
              ) : (
                <video key={b.id} {...props} src={mediaUrl.preview(m)} muted playsInline preload="auto" />
              );
            })}
            <SubtitleOverlay pages={pages} style={doc.subtitles} />
            <StageItems stageScale={scale} begin={begin} guides={guides} />
          </div>
          {!doc.clips.length && (
            <label className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-3 p-4 text-center text-sm text-muted hover:text-fg">
              <Upload size={26} />
              <span>
                Arrastra aquí tus vídeos o fotos
                <br />
                <span className="text-xs text-faint">o usa Importar en el panel</span>
              </span>
              <input type="file" multiple accept="video/*,image/*,.mov" hidden onChange={(e) => void uploadClips([...(e.target.files ?? [])])} />
            </label>
          )}
          {preparing && (
            <div className="absolute inset-x-2 top-2 flex items-center gap-2 rounded-md bg-black/75 px-2.5 py-1.5 text-[11px]">
              <Loader2 size={12} className="shrink-0 animate-spin text-accent" /> Preparando la vista previa… {Math.round(preparing.progress * 100)}%
            </div>
          )}
        </div>
      </div>
      {doc.audio.map((a) => {
        const m = media[a.mediaId];
        return m ? <audio key={a.id} ref={audioRef(a.id)} src={`/api/media/${m.id}/file`} preload="auto" /> : null;
      })}
      <div className="flex shrink-0 items-center justify-center gap-1.5 border-t border-line px-2" style={{ height: PLAYER_CONTROLS }}>
        <IconButton label="Ir al principio (Inicio)" onClick={() => player.seek(0)}>
          <SkipBack size={15} />
        </IconButton>
        <button
          onClick={() => player.toggle()}
          onMouseUp={(e) => e.currentTarget.blur()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-black hover:bg-accent-strong"
          aria-label={playing ? 'Pausar (espacio)' : 'Reproducir (espacio)'}
          title={playing ? 'Pausar (espacio)' : 'Reproducir (espacio)'}
        >
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
        </button>
        <IconButton label="Ir al final (Fin)" onClick={() => player.seek(usePlayback.getState().duration)}>
          <SkipForward size={15} />
        </IconButton>
        <TimeDisplay />
      </div>
    </section>
  );
}
