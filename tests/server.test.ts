import { describe, expect, it } from 'vitest';
import { createProjectDoc, type ProjectDoc } from '@/lib/shared/types';
import { alignPunctuation, finalizeWords } from '@/lib/server/transcribe/align';
import { parseWhisperCppJson } from '@/lib/server/transcribe/whispercpp';
import { buildExportPlan, type PlanMedia } from '@/lib/server/export';

describe('transcription parsing', () => {
  it('restores punctuation from OpenAI segments', () => {
    const words = [
      { word: 'hola', start: 0, end: 0.3 },
      { word: 'que', start: 0.4, end: 0.6 },
      { word: 'tal', start: 0.6, end: 0.9 },
    ];
    const out = alignPunctuation(words, [{ text: ' Hola, ¿qué tal?', start: 0, end: 1 }]);
    expect(out.map((w) => w.word)).toEqual(['Hola,', '¿qué', 'tal?']);
  });

  it('parses whisper.cpp JSON and merges stray punctuation', () => {
    const words = parseWhisperCppJson({
      transcription: [
        { offsets: { from: 0, to: 300 }, text: ' Hola' },
        { offsets: { from: 300, to: 320 }, text: ',' },
        { offsets: { from: 400, to: 800 }, text: ' amigos' },
        { offsets: { from: 800, to: 900 }, text: ' [MÚSICA]' },
      ],
    });
    expect(words).toEqual([
      { word: 'Hola,', start: 0, end: 0.32 },
      { word: 'amigos', start: 0.4, end: 0.8 },
    ]);
    expect(finalizeWords(words).map((w) => w.id)).toEqual(['w0', 'w1']);
  });
});

describe('export plan', () => {
  const media = new Map<string, PlanMedia>([
    ['m1', { id: 'm1', kind: 'video', sourcePath: '/a.mp4', hasAudio: true }],
    ['m2', { id: 'm2', kind: 'video', sourcePath: '/b.mov', hasAudio: false }],
    ['img', { id: 'img', kind: 'image', sourcePath: '/i.png', hasAudio: false }],
    ['mus', { id: 'mus', kind: 'audio', sourcePath: '/m.mp3', hasAudio: true }],
  ]);
  const doc = (): ProjectDoc => ({
    ...createProjectDoc('p1', 'Test'),
    clips: [
      { id: 'c1', mediaId: 'm1', start: 0, end: 10, cuts: [{ start: 2, end: 3, reason: 'silence' }] },
      { id: 'c2', mediaId: 'm2', start: 1, end: 4, cuts: [] },
    ],
    broll: [{ id: 'b1', mediaId: 'img', start: 1, duration: 2, srcIn: 0 }],
    audio: [{ id: 'a1', mediaId: 'mus', start: 0.5, duration: 30, srcIn: 0, volume: 0.3, fadeIn: 1, fadeOut: 1 }],
  });

  it('builds one input per clip instance with a frame-exact select', () => {
    const plan = buildExportPlan(doc(), media, {});
    expect(plan.duration).toBeCloseTo(9 + 3, 5);
    expect(plan.inputs[0]).toEqual(['-ss', '0', '-t', '10.5', '-i', '/a.mp4']);
    expect(plan.filter).toContain("select='gte(t,-0.01667)*lt(t,1.98333)+gte(t,2.98333)*lt(t,9.98333)'");
    expect(plan.filter).toContain('anullsrc'.length ? 'concat=n=2:v=1:a=1[vcat][acat]' : '');
    expect(plan.inputs.some((i) => i.includes('anullsrc=r=48000:cl=stereo'))).toBe(true);
    expect(plan.filter).toContain("overlay=0:0:eof_action=pass:enable='between(t,1,2.999)'");
    expect(plan.filter).toContain('adelay=500|500');
    expect(plan.filter).toContain('amix=inputs=2');
    expect(plan.ass).toBeNull(); // no transcript → no subtitles
  });

  it('rejects an empty timeline', () => {
    expect(() => buildExportPlan({ ...doc(), clips: [] }, media, {})).toThrow(/vacía/);
  });
});
