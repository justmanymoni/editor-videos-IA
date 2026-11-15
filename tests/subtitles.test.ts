import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_SUBTITLE_STYLE } from '@/lib/shared/types';
import { activeAt, buildPages, subtitleText, type SubWord } from '@/lib/shared/subtitles';
import { assInlineColor, assStyleColor, assTime, buildAss } from '@/lib/shared/ass';
import { SUBTITLE_FONTS, assFontSize, getFont } from '@/lib/shared/fonts';
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
    expect(subtitleText('hola,', { uppercase: false, stripPunctuation: false })).toBe('hola,');
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
    const ass = buildAss(pages, DEFAULT_SUBTITLE_STYLE);
    const events = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    expect(events).toHaveLength(1);
    expect(events[0]).toContain('0:00:01.00,0:00:02.35');
    expect(events[0]).toContain('{\\an5\\pos(540,1382)}');
    // First word: yellow from the start, white again when the second word starts (500 ms in).
    expect(events[0]).toContain('{\\1c&HFFFFFF&\\1c&H00E6FF&\\t(500,500,\\1c&HFFFFFF&)}HOLA');
    expect(events[0]).toContain('{\\1c&HFFFFFF&\\t(500,500,\\1c&H00E6FF&)\\t(1350,1350,\\1c&HFFFFFF&)}MUNDO');
    expect(ass).toContain(`Style: Sub,Montserrat Black,${Math.round(assFontSize(getFont('montserrat-black'), 86) * 100) / 100},`);
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
