/**
 * Builds an Advanced SubStation Alpha script that libass (FFmpeg `subtitles`
 * filter) burns into the export. One event per word: the page text stays
 * the same and only the highlighted word changes.
 */
import type { SubtitleStyle } from './types';
import { OUTPUT_HEIGHT, OUTPUT_WIDTH } from './types';
import type { SubPage } from './subtitles';
import { assFontSize, getFont } from './fonts';

const hex = (color: string) => {
  const h = color.replace('#', '').trim();
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h.padEnd(6, '0').slice(0, 6);
  return { r: full.slice(0, 2), g: full.slice(2, 4), b: full.slice(4, 6) };
};

/** "#RRGGBB" → "&HAABBGGRR" (style colours). Alpha 0 = opaque. */
export function assStyleColor(color: string, alpha = 0): string {
  const { r, g, b } = hex(color);
  return `&H${alpha.toString(16).padStart(2, '0')}${b}${g}${r}`.toUpperCase();
}

/** "#RRGGBB" → "&HBBGGRR&" (inline override colours). */
export function assInlineColor(color: string): string {
  const { r, g, b } = hex(color);
  return `&H${b}${g}${r}&`.toUpperCase();
}

export function assTime(t: number): string {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor(cs / 6000) % 60;
  const s = Math.floor(cs / 100) % 60;
  const c = cs % 100;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${h}:${p(m)}:${p(s)}.${p(c)}`;
}

const escapeText = (t: string) => t.replace(/\\/g, '＼').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\n/g, ' ');

export function buildAss(pages: SubPage[], style: SubtitleStyle): string {
  const font = getFont(style.fontId);
  const size = Math.round(assFontSize(font, style.fontSize) * 100) / 100;
  const y = Math.round((style.positionY / 100) * OUTPUT_HEIGHT);
  const base = assInlineColor(style.textColor);
  const hl = assInlineColor(style.highlightColor);
  const scale = Math.round(style.activeScale * 100);

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${OUTPUT_WIDTH}`,
    `PlayResY: ${OUTPUT_HEIGHT}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Sub,${font.assFamily},${size},${assStyleColor(style.textColor)},${assStyleColor(style.highlightColor)},${assStyleColor(style.outlineColor)},${assStyleColor('#000000', 0x80)},0,0,0,0,100,100,0,0,1,${style.outlineWidth},${style.shadow},5,0,0,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const events: string[] = [];
  for (const page of pages) {
    page.words.forEach((_, active) => {
      const start = active === 0 ? page.start : page.words[active].start;
      const end = page.activeEnd[active];
      if (end - start < 0.005) return;
      const text = page.lines
        .map((line) =>
          line
            .map((wi) => {
              const t = escapeText(page.words[wi].text);
              if (wi !== active) return t;
              const on = scale !== 100 ? `\\fscx${scale}\\fscy${scale}` : '';
              const off = scale !== 100 ? '\\fscx100\\fscy100' : '';
              return `{\\1c${hl}${on}}${t}{\\1c${base}${off}}`;
            })
            .join(' '),
        )
        .join('\\N');
      events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Sub,,0,0,0,,{\\an5\\pos(${OUTPUT_WIDTH / 2},${y})}${text}`);
    });
  }
  return [...header, ...events, ''].join('\n');
}
