import { describe, expect, it } from 'vitest';
import { alignScript } from '@/lib/shared/script';
import { buildSrt, buildVtt, transcriptText, captionPages } from '@/lib/shared/text-export';
import { buildClipWords, buildSegments } from '@/lib/shared/timeline';
import type { MainClip, Word } from '@/lib/shared/types';

describe('script alignment', () => {
  it('fixes recognition mistakes with the script wording, keeping one text per spoken word', () => {
    const spoken = ['hoy', 'el', 'dia', 'esta', 'nublao', 'y', 'quiero', 'que', 'mañana', 'aga', 'sol'];
    const res = alignScript(spoken, 'Hoy el día está nublado, y quiero que mañana haga sol.');
    expect(spoken.map((w, i) => res.texts.get(i) ?? w)).toEqual([
      'Hoy',
      'el',
      'día',
      'está',
      'nublado,',
      'y',
      'quiero',
      'que',
      'mañana',
      'haga',
      'sol.',
    ]);
    expect(res.extraSpoken).toBe(0);
  });

  it('keeps ad-libs and attaches script words that were not recognised', () => {
    const spoken = ['eh', 'hola', 'a', 'todos', 'bienvenidos'];
    const res = alignScript(spoken, 'Hola a todos y bienvenidos al canal.');
    expect(res.texts.has(0)).toBe(false); // "eh" is not in the script
    expect(res.texts.get(3)).toBe('todos y');
    expect(res.texts.get(4)).toBe('bienvenidos al canal.');
    expect(res.extraSpoken).toBe(1);
    expect(res.attached).toBe(3);
  });
});

describe('script slashes', () => {
  it('turns "/" into subtitle block starts, wherever the slash is typed', () => {
    const spoken = ['el', 'lobo', 'enfurecido', 'esta', 'en', 'el', 'bosque'];
    const res = alignScript(spoken, 'El lobo / enfurecido/ está en el bosque');
    expect(res.hasBreaks).toBe(true);
    expect(res.breaks).toEqual([2, 3]);
    expect(res.texts.get(2)).toBeUndefined(); // "enfurecido" unchanged, no slash in the text
    expect(res.texts.get(3)).toBe('está');
    expect(alignScript(spoken, 'El lobo enfurecido está en el bosque').hasBreaks).toBe(false);
  });
});

describe('text export', () => {
  const words: Word[] = ['Hola', 'a', 'todos.', 'Eh', 'esto', 'es', 'una', 'prueba.'].map((text, i) => ({
    id: `w${i}`,
    text,
    start: 0.5 + i * 0.4,
    end: 0.8 + i * 0.4,
  }));
  const clip: MainClip = { id: 'c', mediaId: 'm', start: 0, end: 5, cuts: [{ start: 1.7, end: 2.1, reason: 'filler' }] };
  const cw = buildClipWords({ clips: [clip], words: { 'm:w4': { text: 'ESTO' } } }, { m: words }, buildSegments([clip]));

  it('exports the transcript as recognised, without cut words: subtitle edits do not change it', () => {
    expect(transcriptText(cw)).toBe('Hola a todos. esto es una prueba.');
    expect(transcriptText(cw, true)).toBe('Hola a todos. Eh esto es una prueba.');
  });

  it('builds SRT and VTT with the edited subtitle text and timings', () => {
    const pages = captionPages(cw);
    const srt = buildSrt(pages);
    expect(srt.startsWith('1\n00:00:00,500 --> ')).toBe(true);
    expect(srt).toContain('Hola a todos.');
    expect(srt).toContain('ESTO es una prueba.');
    expect(buildVtt(pages).startsWith('WEBVTT\n\n00:00:00.500 --> ')).toBe(true);
  });
});
