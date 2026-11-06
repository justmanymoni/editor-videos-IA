'use client';
import { Fragment } from 'react';
import type { SubtitleStyle } from '@/lib/shared/types';
import { OUTPUT_HEIGHT } from '@/lib/shared/types';
import { activeAt, type SubPage } from '@/lib/shared/subtitles';
import { cssFamily, getFont, lineHeightFactor } from '@/lib/shared/fonts';
import { usePlayback } from '@/lib/client/player';

/**
 * Renders the active subtitle page in 1080x1920 coordinates with the same
 * font, size, line height, outline and position the ASS export uses.
 */
export function SubtitleOverlay({ pages, style, sample }: { pages: SubPage[]; style: SubtitleStyle; sample?: SubPage }) {
  const active = usePlayback((s) => {
    const a = activeAt(pages, s.time);
    return a ? a.page * 10000 + a.word : -1;
  });
  if (!style.enabled) return null;
  const page = active >= 0 ? pages[Math.floor(active / 10000)] : sample;
  const word = active >= 0 ? active % 10000 : 0;
  if (!page) return null;
  return <SubtitleBlock page={page} word={word} style={style} />;
}

export function SubtitleBlock({ page, word, style }: { page: SubPage; word: number; style: SubtitleStyle }) {
  const font = getFont(style.fontId);
  return (
    <div
      className="pointer-events-none absolute inset-x-0 text-center"
      style={{
        top: (style.positionY / 100) * OUTPUT_HEIGHT,
        transform: 'translateY(-50%)',
        fontFamily: `"${cssFamily(font)}"`,
        fontSize: style.fontSize,
        lineHeight: lineHeightFactor(font),
        color: style.textColor,
        WebkitTextStroke: style.outlineWidth > 0 ? `${style.outlineWidth * 2}px ${style.outlineColor}` : undefined,
        textShadow: style.shadow > 0 ? `${style.shadow}px ${style.shadow}px 0 rgba(0,0,0,0.5)` : undefined,
      }}
    >
      {page.lines.map((line, li) => (
        <div key={li} className="sub-text">
          {line.map((wi, k) => (
            <Fragment key={wi}>
              {k > 0 && ' '}
              <span
                style={
                  wi === word ? { color: style.highlightColor, fontSize: style.activeScale !== 1 ? `${style.activeScale}em` : undefined } : undefined
                }
              >
                {page.words[wi].text}
              </span>
            </Fragment>
          ))}
        </div>
      ))}
    </div>
  );
}
