'use client';
import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import type { SubtitleAnimation, TextAnimation, TextItem } from '@/lib/shared/types';
import { ANIMATIONS, blockPose, isLetterAnimation, letterPose, letterStep } from '@/lib/shared/subtitle-anim';
import { TEXT_ANIMATIONS, textPose } from '@/lib/shared/text-anim';
import { selRefs, useEditor } from '@/lib/client/store';
import { pickItems, updateItems } from '@/lib/client/actions';
import { Section, Toggle } from '@/components/ui';

/** The thumbnail plays the animation in a loop, slower than in the video so it can be followed. */
const SAMPLE = 'Hola';
const BLOCK_SECONDS = 1.3;
const PAUSE_SECONDS = 0.35;
const SLOWDOWN = 2;
/** Frame pixels → thumbnail pixels. */
const THUMB_SCALE = 0.2;

/** Draws one moment of an animation on the sample word: `t` seconds into a block of BLOCK_SECONDS. */
type Painter = (t: number, word: HTMLElement, letters: HTMLElement[]) => void;

const subtitlePainter = (value: SubtitleAnimation): Painter => {
  const style = { animationIn: value, animationOut: 'none' as const };
  const perLetter = isLetterAnimation(value);
  return (t, word, letters) => {
    const pose = blockPose(style, t, BLOCK_SECONDS - t, BLOCK_SECONDS);
    word.style.opacity = String(pose.opacity);
    word.style.transform = `translate(${pose.dx * THUMB_SCALE}px, ${pose.dy * THUMB_SCALE}px) scale(${pose.scale}) rotate(${pose.rotate}deg)`;
    word.style.filter = pose.blur ? `blur(${pose.blur * THUMB_SCALE}px)` : '';
    const step = letterStep(letters.length, BLOCK_SECONDS);
    letters.forEach((l, i) => {
      const p = perLetter ? letterPose(value, i, step, t) : { opacity: 1, scale: 1 };
      l.style.opacity = String(p.opacity);
      l.style.transform = p.scale !== 1 ? `scale(${p.scale})` : '';
    });
  };
};

const textPainter = (value: TextAnimation, phase: 'in' | 'out'): Painter => {
  const item = phase === 'in' ? { animIn: value, animOut: 'none' as const } : { animIn: 'none' as const, animOut: value };
  return (t, word) => {
    const pose = textPose(item, t, BLOCK_SECONDS);
    word.style.opacity = String(pose.opacity);
    word.style.transform = `translate(${pose.dx * THUMB_SCALE}px, ${pose.dy * THUMB_SCALE}px) scale(${pose.scale})`;
  };
};

/** A looping miniature of one animation, drawn with the same formulas as the preview and the export. */
function AnimationThumb({ paint, still }: { paint: Painter; still: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const letters = [...el.querySelectorAll<HTMLElement>('[data-l]')];
    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const cycle = ((now - started) / 1000 / SLOWDOWN) % (BLOCK_SECONDS + PAUSE_SECONDS);
      paint(Math.min(cycle, BLOCK_SECONDS), el, letters);
      if (cycle > BLOCK_SECONDS && !still) el.style.opacity = '0';
      if (!still) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paint, still]);
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
function AnimationGrid<T extends string>({
  group,
  options,
  value,
  onChange,
  painter,
}: {
  group: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  painter: (v: T) => Painter;
}) {
  // One painter per option, kept between renders so the thumbnails do not restart.
  const painters = useRef(new Map<T, Painter>());
  const painterOf = (v: T) => {
    if (!painters.current.has(v)) painters.current.set(v, painter(v));
    return painters.current.get(v)!;
  };
  return (
    <div className="grid grid-cols-3 gap-1.5" data-animation-group={group}>
      {options.map((a) => (
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
          <AnimationThumb paint={painterOf(a.value)} still={a.value === 'none'} />
          <span className={clsx('truncate px-0.5 text-[10px] leading-tight', value === a.value ? 'text-accent' : 'text-muted')} title={a.label}>
            {a.label}
          </span>
        </button>
      ))}
    </div>
  );
}

const TEXT_IN_OPTIONS = TEXT_ANIMATIONS.map((a) => ({ value: a.value, label: a.label }));
const TEXT_OUT_OPTIONS = TEXT_ANIMATIONS.map((a) => ({ value: a.value, label: a.out }));
const paintTextIn = (v: TextAnimation) => textPainter(v, 'in');
const paintTextOut = (v: TextAnimation) => textPainter(v, 'out');

/** How the selected text (or texts) comes in and goes out. */
function TextAnimations({ texts }: { texts: TextItem[] }) {
  const set = (patch: Partial<TextItem>) => updateItems(texts.map((x) => ({ kind: 'text' as const, id: x.id, patch })));
  return (
    <>
      <Section title={texts.length > 1 ? `Entrada de los ${texts.length} textos` : 'Entrada del texto'}>
        <AnimationGrid group="text-in" options={TEXT_IN_OPTIONS} value={texts[0].animIn} onChange={(v) => set({ animIn: v })} painter={paintTextIn} />
      </Section>
      <Section title={texts.length > 1 ? 'Salida de los textos' : 'Salida del texto'}>
        <AnimationGrid
          group="text-out"
          options={TEXT_OUT_OPTIONS}
          value={texts[0].animOut}
          onChange={(v) => set({ animOut: v })}
          painter={paintTextOut}
        />
        <p className="text-[11px] leading-relaxed text-faint">Las animaciones se ven al reproducir el vídeo y salen igual en el MP4.</p>
      </Section>
    </>
  );
}

/** Animation tab: of the selected texts, or of the subtitles when no text is selected. */
export function AnimationPanel() {
  const doc = useEditor((s) => s.doc)!;
  const selection = useEditor((s) => s.selection);
  const commit = useEditor((s) => s.commit);
  const style = doc.subtitles;
  const texts = pickItems(doc, selRefs(selection))
    .filter((x) => x.kind === 'text')
    .map((x) => x.item as TextItem);
  return (
    <div className="h-full overflow-y-auto">
      {texts.length > 0 ? (
        <TextAnimations texts={texts} />
      ) : (
        <>
          <Section title="Entrada de los subtítulos">
            <AnimationGrid
              group="subtitles"
              options={ANIMATIONS}
              value={style.animationIn}
              onChange={(v) => commit((d) => void (d.subtitles.animationIn = v))}
              painter={subtitlePainter}
            />
          </Section>
          <Section title="Salida de los subtítulos">
            <Toggle
              label="Desvanecer al salir"
              checked={style.animationOut === 'fade'}
              onChange={(v) => commit((d) => void (d.subtitles.animationOut = v ? 'fade' : 'none'))}
            />
            <p className="text-[11px] leading-relaxed text-faint">
              Para animar un texto que has añadido tú, selecciónalo en la línea de tiempo: sus animaciones aparecen aquí.
            </p>
          </Section>
        </>
      )}
    </div>
  );
}
