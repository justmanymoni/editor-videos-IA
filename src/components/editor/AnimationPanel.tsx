'use client';
import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import type { SubtitleAnimation } from '@/lib/shared/types';
import { ANIMATIONS, blockPose, isLetterAnimation, letterPose, letterStep } from '@/lib/shared/subtitle-anim';
import { useEditor } from '@/lib/client/store';
import { Section, Toggle } from '@/components/ui';

/** The thumbnail plays the animation in a loop, slower than in the video so it can be followed. */
const SAMPLE = 'Hola';
const BLOCK_SECONDS = 1.3;
const PAUSE_SECONDS = 0.35;
const SLOWDOWN = 2;
/** Frame pixels → thumbnail pixels. */
const THUMB_SCALE = 0.2;

/** A looping miniature of one animation, drawn with the same formulas as the preview and the export. */
function AnimationThumb({ value }: { value: SubtitleAnimation }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const letters = [...el.querySelectorAll<HTMLElement>('[data-l]')];
    const perLetter = isLetterAnimation(value);
    const step = letterStep(letters.length, BLOCK_SECONDS);
    const style = { animationIn: value, animationOut: 'none' as const };
    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const cycle = ((now - started) / 1000 / SLOWDOWN) % (BLOCK_SECONDS + PAUSE_SECONDS);
      const t = Math.min(cycle, BLOCK_SECONDS);
      const pose = blockPose(style, t, BLOCK_SECONDS - t, BLOCK_SECONDS);
      el.style.opacity = cycle > BLOCK_SECONDS && value !== 'none' ? '0' : String(pose.opacity);
      el.style.transform = `translate(${pose.dx * THUMB_SCALE}px, ${pose.dy * THUMB_SCALE}px) scale(${pose.scale}) rotate(${pose.rotate}deg)`;
      el.style.filter = pose.blur ? `blur(${pose.blur * THUMB_SCALE}px)` : '';
      letters.forEach((l, i) => {
        const p = perLetter ? letterPose(value, i, step, t) : { opacity: 1, scale: 1 };
        l.style.opacity = String(p.opacity);
        l.style.transform = p.scale !== 1 ? `scale(${p.scale})` : '';
      });
      if (value !== 'none') raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <span className="flex h-11 items-center justify-center overflow-hidden rounded bg-black">
      <span ref={ref} className="text-[15px] font-black text-white will-change-transform">
        {[...SAMPLE].map((ch, i) => (
          <span key={i} data-l={i} className="inline-block">
            {ch}
          </span>
        ))}
      </span>
    </span>
  );
}

/** Grid of animations to choose from, each with its moving thumbnail. */
export function AnimationGrid({ value, onChange }: { value: SubtitleAnimation; onChange: (v: SubtitleAnimation) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {ANIMATIONS.map((a) => (
        <button
          key={a.value}
          data-animation={a.value}
          onClick={() => onChange(a.value)}
          onMouseUp={(e) => e.currentTarget.blur()}
          className={clsx(
            'flex flex-col gap-1 rounded-md border p-1 text-left transition-colors',
            value === a.value ? 'border-accent bg-accent/10' : 'border-transparent bg-panel-3 hover:border-line-strong',
          )}
        >
          <AnimationThumb value={a.value} />
          <span className={clsx('truncate px-0.5 text-[10px] leading-tight', value === a.value ? 'text-accent' : 'text-muted')} title={a.label}>
            {a.label}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Animation tab: how the subtitles come in and go out. */
export function AnimationPanel() {
  const style = useEditor((s) => s.doc!.subtitles);
  const commit = useEditor((s) => s.commit);
  return (
    <div className="h-full overflow-y-auto">
      <Section title="Entrada de los subtítulos">
        <AnimationGrid value={style.animationIn} onChange={(v) => commit((d) => void (d.subtitles.animationIn = v))} />
      </Section>
      <Section title="Salida de los subtítulos">
        <Toggle
          label="Desvanecer al salir"
          checked={style.animationOut === 'fade'}
          onChange={(v) => commit((d) => void (d.subtitles.animationOut = v ? 'fade' : 'none'))}
        />
      </Section>
    </div>
  );
}
