import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_TEXT, normalizeSubtitleStyle, shadowOffset } from '@/lib/shared/types';
import { activeAt, buildPages, subtitleText, type SubWord } from '@/lib/shared/subtitles';
import { assInlineColor, assStyleColor, assTime, buildAss } from '@/lib/shared/ass';
import { SUBTITLE_FONTS, assFontSize, fontVariant, getFont, isBoldFont } from '@/lib/shared/fonts';
import { readFontInfo } from '@/lib/server/ttf';

const sw = (text: string, start: number, end: number, extra: Partial<SubWord> = {}): SubWord => ({
  key: text + start,
  text,
  start,
  end,
  breakBefore: false,
  sentenceEnd: /[.!?]$/.test(text),
  ...extra,
});

describe('subtitle pages', () => {
  it('formats text', () => {
    expect(subtitleText('¿qué tal?', DEFAULT_SUBTITLE_STYLE)).toBe('QUÉ TAL');
    expect(subtitleText('hola,', { textCase: 'none', stripPunctuation: false })).toBe('hola,');
  });

  it('groups words per page, breaking on punctuation, pauses and forced breaks', () => {
    const words = [
      sw('UNO', 0, 0.3),
      sw('DOS', 0.35, 0.6),
      sw('TRES.', 0.65, 0.9),
      sw('CUATRO', 1.0, 1.3),
      sw('CINCO', 2.5, 2.8),
      sw('SEIS', 2.9, 3.1, { breakBefore: true }),
    ];
    const pages = buildPages(words, { wordsPerPage: 3, maxCharsPerLine: 16 });
    expect(pages.map((p) => p.words.map((w) => w.text).join(' '))).toEqual(['UNO DOS TRES.', 'CUATRO', 'CINCO', 'SEIS']);
    expect(pages[0].activeEnd[0]).toBeCloseTo(0.35);
    expect(pages[0].end).toBeCloseTo(1.0); // held until the next page starts
    expect(activeAt(pages, 0.5)).toEqual({ page: 0, word: 1 });
    expect(activeAt(pages, 2.0)).toBeNull();
  });

  it('wraps long pages into at most two lines', () => {
    const words = [sw('INCREÍBLEMENTE', 0, 0.5), sw('LARGO', 0.5, 0.7), sw('TEXTO', 0.7, 0.9)];
    const pages = buildPages(words, { wordsPerPage: 3, maxCharsPerLine: 14 });
    expect(pages[0].lines).toEqual([[0], [1, 2]]);
  });
});

describe('ASS export', () => {
  it('converts colours and times', () => {
    expect(assStyleColor('#FFE600')).toBe('&H0000E6FF');
    expect(assInlineColor('#FFE600')).toBe('&H00E6FF&');
    expect(assTime(3723.456)).toBe('1:02:03.46');
  });

  it('emits one event per block and recolours the spoken word with timed transforms', () => {
    const pages = buildPages([sw('HOLA', 1, 1.4), sw('MUNDO', 1.5, 2)], { wordsPerPage: 3, maxCharsPerLine: 16 });
    const ass = buildAss(pages, { ...DEFAULT_SUBTITLE_STYLE, shadowOn: false });
    const events = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    expect(events).toHaveLength(1);
    expect(events[0]).toContain('0:00:01.00,0:00:02.35');
    expect(events[0]).toContain('{\\an5\\pos(540,1382)}');
    // First word: yellow from the start, white again when the second word starts (500 ms in).
    expect(events[0]).toContain('{\\1c&HFFFFFF&\\1c&H00E6FF&\\t(500,500,\\1c&HFFFFFF&)}HOLA');
    expect(events[0]).toContain('{\\1c&HFFFFFF&\\t(500,500,\\1c&H00E6FF&)\\t(1350,1350,\\1c&HFFFFFF&)}MUNDO');
    // Montserrat (bold), without outline or libass shadow.
    expect(ass).toContain(`Style: Sub,Montserrat,${Math.round(assFontSize(getFont('montserrat-bold'), 86) * 100) / 100},`);
    expect(ass).toMatch(/Style: Sub,.*,-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1$/m);
  });

  it('draws the shadow as its own layer: shifted, blurred and see-through', () => {
    const pages = buildPages([sw('HOLA', 1, 1.4), sw('MUNDO', 1.5, 2)], { wordsPerPage: 3, maxCharsPerLine: 16 });
    const style = {
      ...DEFAULT_SUBTITLE_STYLE,
      shadowOn: true,
      shadow: 10,
      shadowAngle: -90,
      shadowBlur: 12,
      shadowOpacity: 0.5,
      shadowColor: '#102030',
    };
    const events = buildAss(pages, style)
      .split('\n')
      .filter((l) => l.startsWith('Dialogue:'));
    expect(events).toHaveLength(2);
    const [shadow, text] = events;
    expect(shadow.startsWith('Dialogue: 0,')).toBe(true);
    expect(text.startsWith('Dialogue: 2,')).toBe(true);
    // −90° is straight down: same x, 10 px lower; blur 12 px → strength 6.
    expect(shadow).toContain('{\\an5\\pos(540,1392)\\blur6}');
    expect(text).toContain('{\\an5\\pos(540,1382)}');
    // Shadow colour (BGR) at 50 %; the words never take the highlight colour.
    expect(shadow).toContain('\\1c&H302010&\\3c&H302010&\\1a&H80&\\3a&H80&');
    expect(shadow).not.toContain('&H00E6FF&');
    // No shadow when it is off or fully transparent.
    for (const off of [{ shadowOn: false }, { shadowOpacity: 0 }, { shadow: 0, shadowBlur: 0 }]) {
      expect(
        buildAss(pages, { ...style, ...off })
          .split('\n')
          .filter((l) => l.startsWith('Dialogue:')),
      ).toHaveLength(1);
    }
  });

  it('writes letter spacing and underline in the style', () => {
    const pages = buildPages([sw('HOLA', 1, 1.4)], { wordsPerPage: 3, maxCharsPerLine: 16 });
    const ass = buildAss(pages, { ...DEFAULT_SUBTITLE_STYLE, letterSpacing: 7, underline: true, outlineWidth: 4 });
    expect(ass).toMatch(/Style: Sub,.*,-1,0,-1,0,100,100,7,0,1,4,0,5,0,0,0,1$/m);
  });

  it('writes entrance animations and can turn the highlight off', () => {
    const pages = buildPages([sw('HOLA', 1, 1.4), sw('MUNDO', 1.5, 2)], { wordsPerPage: 3, maxCharsPerLine: 16 });
    const plain = buildAss(pages, { ...DEFAULT_SUBTITLE_STYLE, highlight: false, positionX: 25 });
    expect(plain).toContain('{\\an5\\pos(270,1382)}{\\1c&HFFFFFF&}HOLA {\\1c&HFFFFFF&}MUNDO');
    const slide = buildAss(pages, { ...DEFAULT_SUBTITLE_STYLE, animationIn: 'slide-left', animationOut: 'fade' });
    expect(slide).toContain('\\move(690,1382,540,1382,0,280)\\fad(280,200)');
    const type = buildAss(pages, { ...DEFAULT_SUBTITLE_STYLE, highlight: false, animationIn: 'typewriter' });
    expect(type).toContain('{\\alpha&H00&}H{\\alpha&HFF&\\t(40,40,\\alpha&H00&)}O');
  });
});

describe('font catalog', () => {
  it('matches the metrics of the bundled TTF files', () => {
    for (const font of SUBTITLE_FONTS) {
      const info = readFontInfo(readFileSync(path.join(process.cwd(), 'public', 'fonts', font.file)));
      expect({ family: info.family, upm: info.unitsPerEm, asc: info.winAscent, desc: info.winDescent }).toEqual({
        family: font.assFamily,
        upm: font.unitsPerEm,
        asc: font.winAscent,
        desc: font.winDescent,
      });
    }
  });
});

describe('highlight box and dimmed words in ASS', () => {
  const words = [
    { key: 'a', text: 'HOLA', start: 0, end: 0.4, breakBefore: false, sentenceEnd: false },
    { key: 'b', text: 'MUNDO', start: 0.5, end: 0.9, breakBefore: false, sentenceEnd: false },
  ];
  const pages = buildPages(words, DEFAULT_SUBTITLE_STYLE);

  it('adds a box layer under the text only when asked', () => {
    const plain = buildAss(pages, DEFAULT_SUBTITLE_STYLE);
    expect(plain).not.toContain('Style: Box');
    expect(plain).not.toContain(',Box,');
    const boxed = buildAss(pages, { ...DEFAULT_SUBTITLE_STYLE, highlightBox: true, boxTextColor: '#102030' });
    const lines = boxed.split('\n');
    expect(lines.filter((l) => l.startsWith('Style: Box,')).length).toBe(1);
    const box = lines.find((l) => l.startsWith('Dialogue: 1,') && l.includes(',Box,'))!;
    const text = lines.find((l) => l.startsWith('Dialogue: 2,') && l.includes(',Sub,'))!;
    expect(box).toBeTruthy();
    expect(text).toBeTruthy();
    // Same position in both layers, and padding only on the box.
    expect(box).toContain('\\an5\\pos(540,');
    expect(text).toContain('\\an5\\pos(540,');
    expect(box).toMatch(/\\xbord\d+\\ybord\d+/);
    // The box shows on the first word from the start and on the second when it is said.
    expect(box).toContain('\\3a&HFF&\\3a&H00&');
    expect(box).toContain('\\t(500,500,\\3a&H00&)');
    // In the text layer the active word takes the box text colour.
    expect(text).toContain('\\1c&H302010&');
  });

  it('does not draw a box when the highlight is off', () => {
    expect(buildAss(pages, { ...DEFAULT_SUBTITLE_STYLE, highlight: false, highlightBox: true })).not.toContain('Style: Box');
  });

  it('fades the words that have not been said yet', () => {
    const dim = buildAss(pages, { ...DEFAULT_SUBTITLE_STYLE, dimUpcoming: true });
    expect(dim).toContain('\\1a&H99&');
    expect(dim).toContain('\\t(500,500,\\1a&H00&\\3a&H00&)');
    // Letter animations reveal the text themselves.
    expect(buildAss(pages, { ...DEFAULT_SUBTITLE_STYLE, dimUpcoming: true, animationIn: 'typewriter' })).not.toContain('\\1a&H99&');
  });
});

describe('style of the text', () => {
  it('changes the case of the words', () => {
    expect(subtitleText('Hola, Mundo', { textCase: 'upper', stripPunctuation: true })).toBe('HOLA MUNDO');
    expect(subtitleText('HOLA', { textCase: 'lower', stripPunctuation: true })).toBe('hola');
    expect(subtitleText('¿qué TAL?', { textCase: 'title', stripPunctuation: false })).toBe('¿Qué tal?');
    expect(subtitleText('Hola', { textCase: 'none', stripPunctuation: true })).toBe('Hola');
  });

  it('starts as Montserrat without outline and with a soft shadow', () => {
    expect(DEFAULT_SUBTITLE_STYLE).toMatchObject({ fontId: 'montserrat-bold', outlineWidth: 0, shadowOn: true });
    expect(DEFAULT_SUBTITLE_STYLE.shadowBlur).toBeGreaterThan(0);
    expect(DEFAULT_TEXT).toMatchObject({ fontId: 'montserrat-bold', outlineWidth: 0, shadowOn: true });
  });

  it('keeps the look of projects saved before the shadow could be adjusted', () => {
    const old = normalizeSubtitleStyle({ fontId: 'montserrat-black', outlineWidth: 6, shadow: 4, uppercase: false } as never);
    expect(old).toMatchObject({
      fontId: 'montserrat-black',
      outlineWidth: 6,
      shadowOn: true,
      shadowBlur: 0,
      shadowOpacity: 0.5,
      shadowAngle: -45,
      textCase: 'none',
    });
    expect(old.shadow).toBeCloseTo(5.7, 1); // 4 px right and 4 px down
    expect(normalizeSubtitleStyle({ shadow: 0, uppercase: true } as never)).toMatchObject({ shadowOn: false, textCase: 'upper' });
    // A style saved by this version is left alone.
    const now = normalizeSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, shadow: 9, shadowBlur: 3, textCase: 'title' });
    expect(now).toMatchObject({ shadow: 9, shadowBlur: 3, textCase: 'title' });
  });

  it('puts the shadow where the angle says', () => {
    expect(shadowOffset(10, 0)).toEqual({ dx: 10, dy: 0 });
    expect(shadowOffset(10, -90)).toEqual({ dx: 0, dy: 10 });
    expect(shadowOffset(10, 90)).toEqual({ dx: 0, dy: -10 });
    expect(shadowOffset(10, -45)).toEqual({ dx: 7.07, dy: 7.07 });
  });

  it('finds the bold and italic variants of a font', () => {
    expect(fontVariant('montserrat-regular', { bold: true })).toBe('montserrat-bold');
    expect(fontVariant('montserrat-bold', { bold: false })).toBe('montserrat-regular');
    expect(fontVariant('montserrat-black', { bold: false })).toBe('montserrat-regular');
    expect(fontVariant('montserrat-bold', { italic: true })).toBe('montserrat-italic');
    expect(fontVariant('montserrat-italic', { italic: false })).toBe('montserrat-regular');
    expect(fontVariant('anton', { bold: true })).toBeNull();
    expect(fontVariant('anton', { italic: true })).toBeNull();
    expect(isBoldFont(getFont('montserrat-black'))).toBe(true);
  });
});
