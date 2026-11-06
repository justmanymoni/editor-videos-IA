import { describe, expect, it } from 'vitest';
import type { Envelope, MainClip, Word } from '@/lib/shared/types';
import { computeFillerCuts, computeRetakeCuts, computeSilenceCuts, detectAudioSilences, findFillerIndices } from '@/lib/shared/cleanup';
import { DEFAULT_FILLERS } from '@/lib/shared/types';

const mk = (texts: string[], gap = 0.1, dur = 0.3, pauses: Record<number, number> = {}): Word[] => {
  let t = 0.2;
  return texts.map((text, i) => {
    t += pauses[i] ?? 0;
    const w = { id: `w${i}`, text, start: t, end: t + dur };
    t += dur + gap;
    return w;
  });
};

describe('fillers', () => {
  it('finds single and multi-word fillers, ignoring case, accents and repeated letters', () => {
    const words = mk(['Bueno,', 'eh,', 'esto', 'mmmm', 'o', 'sea,', 'que', 'Ehhh', 'vale.']);
    expect(findFillerIndices(words, DEFAULT_FILLERS)).toEqual([1, 3, 4, 5, 7]);
    expect(computeFillerCuts(words, DEFAULT_FILLERS)[0]).toEqual({ start: words[1].start, end: words[2].start });
  });
});

describe('silences', () => {
  const clip: MainClip = { id: 'c', mediaId: 'm', start: 0, end: 6, cuts: [] };

  it('uses gaps between words, keeping padding next to speech', () => {
    const words = mk(['uno', 'dos', 'tres'], 0.1, 0.3, { 2: 1.0 });
    const cuts = computeSilenceCuts(clip, words, undefined, 0.4, 0.1);
    // leading gap (0..0.2) is too short; pause before "tres"; trailing silence to the end.
    expect(cuts[0].start).toBeCloseTo(words[1].end + 0.1, 5);
    expect(cuts[0].end).toBeCloseTo(words[2].start - 0.1, 5);
    expect(cuts[cuts.length - 1].end).toBe(6);
  });

  it('detects silence in the audio even when Whisper stretches a word', () => {
    // 6 s: speech 0-1 s, silence 1-3 s, speech 3-6 s.
    const values = new Uint8Array(600).map((_, i) => (i >= 100 && i < 300 ? 5 : 70));
    const env: Envelope = { rate: 100, values };
    expect(detectAudioSilences(env, clip, 0.4)).toEqual([{ start: 1, end: 3 }]);
    const stretched: Word[] = [
      { id: 'a', text: 'hola', start: 0.2, end: 2.9 },
      { id: 'b', text: 'adiós', start: 3.0, end: 3.5 },
    ];
    const cuts = computeSilenceCuts(clip, stretched, env, 0.4, 0.1);
    expect(cuts).toHaveLength(2);
    expect(cuts[0].start).toBeCloseTo(1.1, 5);
    expect(cuts[0].end).toBeCloseTo(2.9, 5);
  });

  it('skips audio analysis without usable contrast', () => {
    const env: Envelope = { rate: 100, values: new Uint8Array(600).fill(50) };
    expect(detectAudioSilences(env, clip, 0.4)).toEqual([]);
  });
});

describe('retakes', () => {
  it('keeps the last take of a repeated phrase', () => {
    const words = mk('Hola a todos, hoy vamos a hablar de Hola a todos, hoy vamos a hablar de la inflación.'.split(' '), 0.1, 0.3, { 8: 1.0 });
    const res = computeRetakeCuts([{ clipId: 'c', words, deleted: words.map(() => false) }], DEFAULT_FILLERS);
    expect(res.takes).toBe(1);
    const cuts = res.cuts.get('c')!;
    expect(cuts).toEqual([{ start: words[0].start, end: words[8].start }]);
  });

  it('removes a stutter repeated inside a phrase', () => {
    const words = mk('es un tema muy importante muy importante para tu bolsillo.'.split(' '));
    const res = computeRetakeCuts([{ clipId: 'c', words, deleted: words.map(() => false) }], DEFAULT_FILLERS);
    expect(res.cuts.get('c')).toEqual([{ start: words[3].start, end: words[5].start }]);
  });

  it('works across clips and leaves different sentences alone', () => {
    const a = mk('Este producto es increíble porque'.split(' '));
    const b = mk('Este producto es increíble porque te ahorra tiempo.'.split(' '));
    const c = mk('Me encanta. Lo uso cada día.'.split(' '));
    const res = computeRetakeCuts(
      [
        { clipId: 'a', words: a, deleted: a.map(() => false) },
        { clipId: 'b', words: b, deleted: b.map(() => false) },
        { clipId: 'c', words: c, deleted: c.map(() => false) },
      ],
      DEFAULT_FILLERS,
    );
    expect([...res.cuts.keys()]).toEqual(['a']);
  });
});
