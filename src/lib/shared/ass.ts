/**
 * Builds an Advanced SubStation Alpha script that libass (FFmpeg `subtitles`
 * filter) burns into the export. One event per word: the page text stays
 * the same and only the highlighted word changes.
 */
import type { SubtitleStyle } from './types';
import { OUTPUT_HEIGHT, OUTPUT_WIDTH } from './types';
import type { SubPage } from './subtitles';
import { assFontSize, getFont } from './fonts';
import { DROP_SCALE, LETTER_SETTLE, animTimes, isLetterAnimation, letterStep, slideOffset } from './subtitle-anim';

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

const ms = (seconds: number) => Math.max(0, Math.round(seconds * 1000));

/**
 * One event per subtitle block. The spoken word is recoloured with instant
 * "t" transforms, and the entrance animation uses move, fad and t tags, so
 * everything stays inside a single line that libass lays out once.
 *
 * Tags set in one override block carry over to the text after it, so every
 * word (and every letter, for per-letter animations) states its own values.
 */
export function buildAss(pages: SubPage[], style: SubtitleStyle): string {
  const font = getFont(style.fontId);
  const size = Math.round(assFontSize(font, style.fontSize) * 100) / 100;
  const x = Math.round((style.positionX / 100) * OUTPUT_WIDTH);
  const y = Math.round((style.positionY / 100) * OUTPUT_HEIGHT);
  const base = assInlineColor(style.textColor);
  const hl = assInlineColor(style.highlightColor);
  const scale = Math.round(style.activeScale * 100);
  const anim = style.animationIn;
  const perLetter = isLetterAnimation(anim);

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
    `Style: Sub,${font.assFamily},${size},${assStyleColor(style.textColor)},${assStyleColor(style.highlightColor)},${assStyleColor(style.outlineColor)},${assStyleColor('#000000', 0x80)},${font.bold ? -1 : 0},${font.italic ? -1 : 0},0,0,100,100,0,0,1,${style.outlineWidth},${style.shadow},5,0,0,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const events: string[] = [];
  for (const page of pages) {
    const duration = page.end - page.start;
    if (duration < 0.005) continue;
    const { inDur, outDur } = animTimes(style, duration);
    const inMs = ms(inDur);

    // Block-level entrance.
    const lead = ['\\an5'];
    const off = slideOffset(anim);
    if (inMs && (off.x || off.y)) lead.push(`\\move(${x + off.x},${y + off.y},${x},${y},0,${inMs})`);
    else lead.push(`\\pos(${x},${y})`);
    const fadeIn = inMs && anim !== 'pop' ? inMs : 0;
    if (fadeIn || outDur) lead.push(`\\fad(${fadeIn},${ms(outDur)})`);
    if (inMs && anim === 'rotate') lead.push(`\\frz14\\t(0,${inMs},\\frz0)`);
    if (inMs && anim === 'blur') lead.push(`\\blur14\\t(0,${inMs},\\blur0)`);
    // Scale entrances are repeated in every word, because words also set their own scale.
    let grow = '';
    if (inMs && anim === 'zoom') grow = `\\fscx60\\fscy60\\t(0,${inMs},\\fscx100\\fscy100)`;
    if (inMs && anim === 'pop') {
      const peak = ms(inDur * 0.6);
      grow = `\\fscx50\\fscy50\\t(0,${peak},\\fscx112\\fscy112)\\t(${peak},${inMs},\\fscx100\\fscy100)`;
    }

    const letters = page.words.reduce((n, w) => n + [...w.text].filter((c) => c !== ' ').length, 0);
    const step = letterStep(letters, duration);
    let letter = 0;

    const text = page.lines
      .map((line) =>
        line
          .map((wi) => {
            const word = page.words[wi];
            let tags = `${grow}\\1c${base}`;
            if (style.highlight) {
              const on = wi === 0 ? 0 : ms(word.start - page.start);
              const offAt = ms(page.activeEnd[wi] - page.start);
              const big = scale !== 100 && !perLetter;
              // A transform from 0 to 0 means "during the whole line" in ASS, so the first word is coloured directly.
              tags += on <= 0 ? `\\1c${hl}` : `\\t(${on},${on},\\1c${hl})`;
              if (big) tags += `\\t(${Math.max(on, inMs, 1)},${Math.max(on, inMs, 1)},\\fscx${scale}\\fscy${scale})`;
              tags += `\\t(${offAt},${offAt},\\1c${base}${big ? '\\fscx100\\fscy100' : ''})`;
            }
            let body = escapeText(word.text);
            if (perLetter) {
              body = [...body]
                .map((ch) => {
                  if (ch === ' ') return ch;
                  const at = ms(letter++ * step);
                  const show = at <= 0 ? '\\alpha&H00&' : `\\alpha&HFF&\\t(${at},${at},\\alpha&H00&)`;
                  if (anim === 'typewriter') return `{${show}}${ch}`;
                  const big = Math.round(DROP_SCALE * 100);
                  return `{${show}\\fscx${big}\\fscy${big}\\t(${at},${at + ms(LETTER_SETTLE)},\\fscx100\\fscy100)}${ch}`;
                })
                .join('');
            }
            return `{${tags}}${body}`;
          })
          .join(' '),
      )
      .join('\\N');
    events.push(`Dialogue: 0,${assTime(page.start)},${assTime(page.end)},Sub,,0,0,0,,{${lead.join('')}}${text}`);
  }
  return [...header, ...events, ''].join('\n');
}
