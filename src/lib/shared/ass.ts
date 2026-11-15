/**
 * Builds an Advanced SubStation Alpha script that libass (FFmpeg `subtitles`
 * filter) burns into the export. One event per word: the page text stays
 * the same and only the highlighted word changes.
 */
import type { SubtitleStyle } from './types';
import { OUTPUT_HEIGHT, OUTPUT_WIDTH, shadowOffset } from './types';
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

/** Room between the highlighted word and the edge of its box, as a fraction of the font size: sideways and up/down. */
export const BOX_PAD_X = 0.18;
export const BOX_PAD_Y = 0.03;
/** Opacity of the words that have not been said yet, when they are dimmed. */
export const DIM_OPACITY = 0.4;
/** CSS `text-shadow` blur radius → libass blur strength that looks the same. */
export const SHADOW_BLUR = 0.5;
const alpha = (opacity: number) =>
  `&H${Math.round((1 - opacity) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()}&`;

/**
 * Every subtitle block is laid out once by libass and drawn in up to three
 * events with exactly the same text and sizes, one over another:
 *
 *   0. the shadow: a copy in the shadow colour, shifted and blurred;
 *   1. the box of the word being said (BorderStyle 3), when that style is on;
 *   2. the text itself.
 *
 * The spoken word is recoloured with instant "t" transforms, and the entrance
 * animation uses move, fad and t tags. Tags set in one override block carry
 * over to the text after it, so every word (and every letter, for per-letter
 * animations) states its own values.
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
  const boxed = style.highlight && style.highlightBox;
  const boxText = assInlineColor(style.boxTextColor);
  // Letter animations already reveal the text little by little.
  const dim = style.dimUpcoming && !perLetter;
  const shadowed = style.shadowOn && style.shadowOpacity > 0 && (style.shadow > 0 || style.shadowBlur > 0);
  const shade = shadowOffset(style.shadow, style.shadowAngle);
  const shadowColor = assInlineColor(style.shadowColor);
  const shadowAlpha = alpha(style.shadowOpacity);
  const shadowBlur = Math.round(style.shadowBlur * SHADOW_BLUR * 100) / 100;

  // Name, font, size, colours, bold, italic, underline, strikeout, scale x/y, spacing, angle, border style, outline, shadow, alignment, margins, encoding.
  const styleLine = (name: string, primary: string, outlineColor: string, borderStyle: number, outline: number) =>
    `Style: ${name},${font.assFamily},${size},${primary},${primary},${outlineColor},${assStyleColor('#000000', 0xff)},${font.bold ? -1 : 0},${font.italic ? -1 : 0},${style.underline ? -1 : 0},0,100,100,${style.letterSpacing},0,${borderStyle},${outline},0,5,0,0,0,1`;

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
    styleLine('Sub', assStyleColor(style.textColor), assStyleColor(style.outlineColor), 1, style.outlineWidth),
    // Same font and size, drawn as an opaque box under the text: its fill is invisible and the box only shows on the active word.
    ...(boxed ? [styleLine('Box', assStyleColor(style.textColor, 0xff), assStyleColor(style.highlightColor), 3, 0)] : []),
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
    const off = slideOffset(anim);

    /** Position, fades and whole-block entrance of one layer, shifted by (dx, dy) and with its own blur. */
    const lead = (dx: number, dy: number, blur: number) => {
      const px = Math.round(x + dx);
      const py = Math.round(y + dy);
      const tags = ['\\an5'];
      if (inMs && (off.x || off.y)) tags.push(`\\move(${px + off.x},${py + off.y},${px},${py},0,${inMs})`);
      else tags.push(`\\pos(${px},${py})`);
      const fadeIn = inMs && anim !== 'pop' ? inMs : 0;
      if (fadeIn || outDur) tags.push(`\\fad(${fadeIn},${ms(outDur)})`);
      if (inMs && anim === 'rotate') tags.push(`\\frz14\\t(0,${inMs},\\frz0)`);
      if (inMs && anim === 'blur') tags.push(`\\blur${14 + blur}\\t(0,${inMs},\\blur${blur})`);
      else if (blur > 0) tags.push(`\\blur${blur}`);
      return tags.join('');
    };

    // Scale entrances are repeated in every word, because words also set their own scale.
    let grow = '';
    if (inMs && anim === 'zoom') grow = `\\fscx60\\fscy60\\t(0,${inMs},\\fscx100\\fscy100)`;
    if (inMs && anim === 'pop') {
      const peak = ms(inDur * 0.6);
      grow = `\\fscx50\\fscy50\\t(0,${peak},\\fscx112\\fscy112)\\t(${peak},${inMs},\\fscx100\\fscy100)`;
    }

    const letters = page.words.reduce((n, w) => n + [...w.text].filter((c) => c !== ' ').length, 0);
    const step = letterStep(letters, duration);

    /** The words of the block for one of the layers; the three share sizes so libass lays them out identically. */
    const layer = (kind: 'text' | 'box' | 'shadow') => {
      let letter = 0;
      return page.lines
        .map((line) =>
          line
            .map((wi) => {
              const word = page.words[wi];
              const on = wi === 0 ? 0 : ms(word.start - page.start);
              const offAt = ms(page.activeEnd[wi] - page.start);
              // When the start of the block was moved past a word, that word is shown as already said.
              const said = offAt <= 0;
              const big = style.highlight && scale !== 100 && !perLetter;
              // A transform from 0 to 0 means "during the whole line" in ASS, so the first word is changed directly.
              const from = (tag: string) => (on <= 0 ? tag : `\\t(${on},${on},${tag})`);
              const grows = big ? `\\t(${Math.max(on, inMs, 1)},${Math.max(on, inMs, 1)},\\fscx${scale}\\fscy${scale})` : '';
              const shrinks = big ? '\\fscx100\\fscy100' : '';
              let tags: string;
              if (kind === 'box') {
                tags = `${grow}\\3a&HFF&`;
                if (!said) tags += `${from('\\3a&H00&')}${grows}\\t(${offAt},${offAt},\\3a&HFF&${shrinks})`;
              } else if (kind === 'shadow') {
                // A copy of the word in the shadow colour. Words still to come cast a fainter shadow, and the word in a box none.
                const solid = `\\1a${shadowAlpha}\\3a${shadowAlpha}`;
                tags = `${grow}\\1c${shadowColor}\\3c${shadowColor}`;
                tags += dim ? `\\1a${alpha(style.shadowOpacity * DIM_OPACITY)}\\3a${alpha(style.shadowOpacity * DIM_OPACITY)}${from(solid)}` : solid;
                if (!said) {
                  if (boxed) tags += from('\\1a&HFF&\\3a&HFF&');
                  tags += grows;
                  if (boxed || big) tags += `\\t(${offAt},${offAt},${boxed ? solid : ''}${shrinks})`;
                }
              } else {
                tags = `${grow}\\1c${base}`;
                // Words still to come are faded.
                if (dim) tags += `\\1a${alpha(DIM_OPACITY)}\\3a${alpha(DIM_OPACITY)}${from('\\1a&H00&\\3a&H00&')}`;
                if (style.highlight && !said) {
                  // In a box the word takes the box's text colour and loses its outline.
                  tags += from(boxed ? `\\1c${boxText}\\3a&HFF&` : `\\1c${hl}`);
                  tags += grows;
                  tags += `\\t(${offAt},${offAt},\\1c${base}${boxed ? '\\3a&H00&' : ''}${shrinks})`;
                }
              }
              let body = escapeText(word.text);
              if (perLetter) {
                body = [...body]
                  .map((ch) => {
                    if (ch === ' ') return ch;
                    const at = ms(letter++ * step);
                    // The box layer only follows the sizes of the letters; the shadow appears with each letter, at its own opacity.
                    const visible = kind === 'shadow' ? `\\1a${shadowAlpha}\\3a${shadowAlpha}` : '\\alpha&H00&';
                    const show = kind === 'box' ? '' : at <= 0 ? visible : `\\alpha&HFF&\\t(${at},${at},${visible})`;
                    if (anim === 'typewriter') return show ? `{${show}}${ch}` : ch;
                    const large = Math.round(DROP_SCALE * 100);
                    return `{${show}\\fscx${large}\\fscy${large}\\t(${at},${at + ms(LETTER_SETTLE)},\\fscx100\\fscy100)}${ch}`;
                  })
                  .join('');
              }
              // The box must not stretch over the space that follows the word.
              return kind === 'box' ? `{${tags}}${body}{\\3a&HFF&}` : `{${tags}}${body}`;
            })
            .join(' '),
        )
        .join('\\N');
    };

    const times = `${assTime(page.start)},${assTime(page.end)}`;
    if (shadowed) events.push(`Dialogue: 0,${times},Sub,,0,0,0,,{${lead(shade.dx, shade.dy, shadowBlur)}}${layer('shadow')}`);
    if (boxed) {
      const pad = `\\xbord${Math.round(style.fontSize * BOX_PAD_X)}\\ybord${Math.round(style.fontSize * BOX_PAD_Y)}`;
      events.push(`Dialogue: 1,${times},Box,,0,0,0,,{${lead(0, 0, 0)}${pad}}${layer('box')}`);
    }
    events.push(`Dialogue: 2,${times},Sub,,0,0,0,,{${lead(0, 0, 0)}}${layer('text')}`);
  }
  return [...header, ...events, ''].join('\n');
}
