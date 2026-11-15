'use client';
/**
 * Automatic subtitles on the preview, in 1080x1920 coordinates with the same
 * font metrics, position and animations as the ASS export.
 *
 * The block can be dragged anywhere on the frame and edited with a double
 * click. Highlight and animations are applied straight to the DOM on every
 * time update, so playback does not re-render React.
 */
import { Fragment, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { SubtitleStyle } from '@/lib/shared/types';
import { OUTPUT_HEIGHT, OUTPUT_WIDTH } from '@/lib/shared/types';
import { clamp } from '@/lib/shared/ranges';
import { activeAt, type SubPage } from '@/lib/shared/subtitles';
import { cssFamily, getFont, lineHeightFactor } from '@/lib/shared/fonts';
import { blockPose, isLetterAnimation, letterPose, letterStep } from '@/lib/shared/subtitle-anim';
import { useEditor } from '@/lib/client/store';
import { player, usePlayback } from '@/lib/client/player';
import { setSubtitleText } from '@/lib/client/actions';

function textStyle(style: SubtitleStyle): React.CSSProperties {
  const font = getFont(style.fontId);
  return {
    fontFamily: `"${cssFamily(font)}"`,
    fontSize: style.fontSize,
    lineHeight: lineHeightFactor(font),
    color: style.textColor,
    WebkitTextStroke: style.outlineWidth > 0 ? `${style.outlineWidth * 2}px ${style.outlineColor}` : undefined,
    textShadow: style.shadow > 0 ? `${style.shadow}px ${style.shadow}px 0 rgba(0,0,0,0.5)` : undefined,
  };
}

export function SubtitleOverlay({ pages, style }: { pages: SubPage[]; style: SubtitleStyle }) {
  const playing = usePlayback((s) => s.playing);
  const activePage = usePlayback((s) => activeAt(pages, s.time)?.page ?? -1);
  const selected = useEditor((s) => (s.selection?.kind === 'subtitle' ? s.selection.page : -1));
  const [editing, setEditing] = useState<number | null>(null);
  const blockRef = useRef<HTMLDivElement>(null);

  // While paused with no subtitle on screen, the first block is shown as a sample to adjust the style.
  const index = activePage >= 0 ? activePage : !playing ? 0 : -1;
  const page: SubPage | undefined = pages[index];
  const sample = activePage < 0;
  const perLetter = isLetterAnimation(style.animationIn);

  useEffect(() => {
    const el = blockRef.current;
    if (!el || !page) return;
    const duration = page.end - page.start;
    const words = [...el.querySelectorAll<HTMLElement>('[data-w]')];
    const letters = [...el.querySelectorAll<HTMLElement>('[data-l]')];
    const step = letterStep(letters.length, duration);
    const apply = (time: number) => {
      // The sample block is shown complete, as if its entrance had finished.
      const t = sample ? duration / 2 : time - page.start;
      const pose = blockPose(style, t, sample ? duration : page.end - time, duration);
      el.style.opacity = String(pose.opacity);
      el.style.transform = `translate(-50%, -50%) translate(${pose.dx}px, ${pose.dy}px) rotate(${pose.rotate}deg) scale(${pose.scale})`;
      el.style.filter = pose.blur ? `blur(${pose.blur}px)` : '';
      words.forEach((w, i) => {
        const on = i === 0 ? 0 : page.words[i].start - page.start;
        const active = style.highlight && t >= on && t < page.activeEnd[i] - page.start;
        w.style.color = active ? style.highlightColor : '';
        w.style.fontSize = active && style.activeScale !== 1 && !perLetter ? `${style.activeScale}em` : '';
      });
      letters.forEach((l, i) => {
        const p = sample ? { opacity: 1, scale: 1 } : letterPose(style.animationIn, i, step, t);
        l.style.opacity = String(p.opacity);
        l.style.fontSize = p.scale !== 1 ? `${p.scale}em` : '';
      });
    };
    apply(usePlayback.getState().time);
    return usePlayback.subscribe((s) => apply(s.time));
  }, [page, style, sample, perLetter, editing]);

  if (!style.enabled || !page) return null;
  const left = (style.positionX / 100) * OUTPUT_WIDTH;
  const top = (style.positionY / 100) * OUTPUT_HEIGHT;

  if (editing === page.index) {
    const finish = (value: string | null) => {
      if (value !== null)
        setSubtitleText(
          page.words.map((w) => w.key),
          value,
        );
      setEditing(null);
    };
    return (
      <textarea
        autoFocus
        defaultValue={page.words.map((w) => w.raw ?? w.text).join(' ')}
        rows={Math.max(1, page.lines.length)}
        onPointerDown={(e) => e.stopPropagation()}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => finish(e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) e.currentTarget.blur();
          if (e.key === 'Escape') finish(null);
        }}
        className="absolute resize-none rounded-lg border-4 border-accent bg-black/60 px-4 text-center outline-none"
        style={{
          ...textStyle(style),
          left,
          top,
          width: OUTPUT_WIDTH * 0.92,
          transform: 'translate(-50%, -50%)',
          WebkitTextStroke: undefined,
          textShadow: undefined,
        }}
      />
    );
  }

  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const stageEl = e.currentTarget.closest('[data-stage]');
    if (!stageEl) return;
    e.stopPropagation();
    e.preventDefault();
    const st = useEditor.getState();
    st.setSelection({ kind: 'subtitle', page: page.index });
    const stage = stageEl.getBoundingClientRect();
    const key = `subtitle-position:${Date.now()}`;
    const move = (ev: PointerEvent) => {
      let x = clamp(style.positionX + ((ev.clientX - e.clientX) / stage.width) * 100, 2, 98);
      const y = clamp(style.positionY + ((ev.clientY - e.clientY) / stage.height) * 100, 2, 98);
      if (Math.abs(x - 50) < 1.5) x = 50; // snap to the centre
      st.commit((d) => {
        d.subtitles.positionX = Math.round(x * 10) / 10;
        d.subtitles.positionY = Math.round(y * 10) / 10;
      }, key);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true });
  };

  let letter = 0;
  return (
    <div
      ref={blockRef}
      data-subtitle={page.index}
      onPointerDown={startDrag}
      onDoubleClick={(e) => {
        e.stopPropagation();
        player.pause();
        setEditing(page.index);
      }}
      title="Arrastra para mover · doble clic para editar"
      className={clsx('absolute cursor-move text-center select-none', selected === page.index && 'outline-dashed outline-accent')}
      style={{ ...textStyle(style), left, top, transform: 'translate(-50%, -50%)', outlineWidth: 4, outlineOffset: 12 }}
    >
      {page.lines.map((line, li) => (
        <div key={li} className="sub-text">
          {line.map((wi, k) => (
            <Fragment key={wi}>
              {k > 0 && ' '}
              <span data-w={wi}>
                {perLetter
                  ? [...page.words[wi].text].map((ch) => (
                      <span key={letter} data-l={letter++}>
                        {ch}
                      </span>
                    ))
                  : page.words[wi].text}
              </span>
            </Fragment>
          ))}
        </div>
      ))}
    </div>
  );
}
