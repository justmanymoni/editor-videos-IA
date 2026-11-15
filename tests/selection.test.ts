import { describe, expect, it } from 'vitest';
import { refKey, selRefs, selectionOf, toggleRef, type SelRef } from '../src/lib/client/store';
import { searchFonts } from '../src/lib/shared/fonts';
import { normalizeSearch, splitTextBlocks } from '../src/lib/shared/text';
import { formatUpdated } from '../src/lib/client/format';

const text = (id: string): SelRef => ({ kind: 'text', id });
const seg = (clipId: string, rangeIndex: number): SelRef => ({ kind: 'segment', clipId, rangeIndex });

describe('selection of several elements', () => {
  it('is nothing, one element or a group', () => {
    expect(selectionOf([])).toBeNull();
    expect(selectionOf([text('a')])).toEqual({ kind: 'text', id: 'a' });
    expect(selectionOf([text('a'), seg('c', 1)])).toEqual({ kind: 'multi', items: [text('a'), seg('c', 1)] });
  });

  it('never holds the same element twice', () => {
    expect(selectionOf([text('a'), text('a')])).toEqual(text('a'));
    expect(refKey(seg('c', 1))).not.toBe(refKey(seg('c', 2)));
    expect(refKey(text('x'))).not.toBe(refKey({ kind: 'audio', id: 'x' }));
  });

  it('adds and removes with Ctrl + click', () => {
    let sel = toggleRef(null, text('a'));
    sel = toggleRef(sel, text('b'));
    sel = toggleRef(sel, { kind: 'subtitle', page: 3 });
    expect(selRefs(sel).map(refKey)).toEqual(['text:a', 'text:b', 'subtitle:3']);
    sel = toggleRef(sel, text('b'));
    expect(selRefs(sel).map(refKey)).toEqual(['text:a', 'subtitle:3']);
    sel = toggleRef(sel, { kind: 'subtitle', page: 3 });
    expect(sel).toEqual(text('a'));
    expect(toggleRef(sel, text('a'))).toBeNull();
  });

  it('ignores the word selection of the transcript', () => {
    expect(selRefs({ kind: 'words', anchor: 1, focus: 4 })).toEqual([]);
  });
});

describe('text blocks', () => {
  it('splits at the slashes', () => {
    expect(splitTextBlocks('el lobo / enfurecido /  está en el bosque ')).toEqual(['el lobo', 'enfurecido', 'está en el bosque']);
    expect(splitTextBlocks(' / ')).toEqual([]);
  });

  it('splits every N words, and still at the slashes', () => {
    expect(splitTextBlocks('uno dos tres cuatro cinco', 2)).toEqual(['uno dos', 'tres cuatro', 'cinco']);
    expect(splitTextBlocks('uno dos tres / cuatro', 1)).toEqual(['uno', 'dos', 'tres', 'cuatro']);
    expect(splitTextBlocks('uno dos tres / cuatro cinco', 2)).toEqual(['uno dos', 'tres', 'cuatro cinco']);
  });

  it('keeps the line breaks of a block that is not split by words', () => {
    expect(splitTextBlocks('dos\nlíneas')).toEqual(['dos\nlíneas']);
  });
});

describe('font search', () => {
  it('ignores case and accents', () => {
    expect(normalizeSearch('  Clásica  ITÁLICA ')).toBe('clasica italica');
    expect(searchFonts('MONTSERRAT').length).toBeGreaterThanOrEqual(4);
    expect(searchFonts('clasica').every((f) => f.group === 'Clásica' || /cl[aá]sic/i.test(f.label))).toBe(true);
  });

  it('finds Arial and Times by their common names', () => {
    expect(searchFonts('arial').map((f) => f.id)).toContain('arimo-regular');
    expect(searchFonts('times').length).toBe(1);
    expect(searchFonts('arial cursiva').length).toBe(1);
  });

  it('returns every font without a query and none for nonsense', () => {
    expect(searchFonts('').length).toBe(searchFonts('   ').length);
    expect(searchFonts('zzzzqq')).toEqual([]);
  });
});

describe('time of the last change', () => {
  const now = new Date(2026, 10, 15, 18, 0);
  it('says today, yesterday or the day', () => {
    expect(formatUpdated(new Date(2026, 10, 15, 9, 5).toISOString(), now)).toBe('Hoy, 9:05');
    expect(formatUpdated(new Date(2026, 10, 14, 23, 30).toISOString(), now)).toBe('Ayer, 23:30');
    expect(formatUpdated(new Date(2026, 10, 2, 14, 32).toISOString(), now)).toMatch(/^2 nov, 14:32$/);
    expect(formatUpdated('no es una fecha', now)).toBe('');
  });
});
