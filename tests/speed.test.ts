import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProjectDoc, type MainClip, type Word } from '@/lib/shared/types';
import { buildClipWords, buildSegments, sequenceDuration, sourceToTimeline, timelineToSource } from '@/lib/shared/timeline';
import { atempo, buildExportPlan, renderPlan, type PlanMedia } from '@/lib/server/export';

const clip = (id: string, start: number, end: number, speed?: number, cuts: MainClip['cuts'] = []): MainClip => ({
  id,
  mediaId: 'm',
  start,
  end,
  cuts,
  speed,
});

describe('clip speed on the timeline', () => {
  it('shortens or lengthens the clip and keeps whole frames', () => {
    const [fast] = buildSegments([clip('a', 0, 6, 2)]);
    expect(fast.tlEnd - fast.tlStart).toBeCloseTo(3, 6);
    expect(fast.rate).toBeCloseTo(2, 6);
    const [slow] = buildSegments([clip('a', 0, 2, 0.5)]);
    expect(slow.tlEnd).toBeCloseTo(4, 6);
    // 1 second at 3x is a third of a second: 10 frames.
    const [third] = buildSegments([clip('a', 0, 1, 3)]);
    expect(Math.round(third.tlEnd * 30)).toBe(10);
    // Normal speed is exactly 1, so nothing changes for existing projects.
    expect(buildSegments([clip('a', 0, 5)])[0]).toMatchObject({ speed: 1, rate: 1, tlEnd: 5 });
  });

  it('maps both ways between the timeline and the source', () => {
    const segs = buildSegments([clip('a', 0, 4, 2, [{ start: 1, end: 2, reason: 'manual' }]), clip('b', 10, 12)]);
    // a: [0,1) → 0..0.5, [2,4) → 0.5..1.5; b at normal speed → 1.5..3.5
    expect(segs.map((s) => [s.tlStart, s.tlEnd])).toEqual([
      [0, 0.5],
      [0.5, 1.5],
      [1.5, 3.5],
    ]);
    expect(sequenceDuration(segs)).toBeCloseTo(3.5, 6);
    expect(timelineToSource(segs, 0.25)!.src).toBeCloseTo(0.5, 6);
    expect(timelineToSource(segs, 1.0)!.src).toBeCloseTo(3, 6);
    expect(timelineToSource(segs, 2.5)!.src).toBeCloseTo(11, 6);
    expect(sourceToTimeline(segs, 'a', 3)).toBeCloseTo(1.0, 6);
    expect(sourceToTimeline(segs, 'a', 1.5, 'next')).toBeCloseTo(0.5, 6);
    expect(sourceToTimeline(segs, 'b', 11)).toBeCloseTo(2.5, 6);
  });

  it('moves the words of the transcript with the speed', () => {
    const words: Word[] = [
      { id: 'w0', text: 'hola', start: 1, end: 1.4 },
      { id: 'w1', text: 'mundo', start: 3, end: 3.6 },
    ];
    const doc = { clips: [clip('a', 0, 4, 2)], words: {} };
    const [cw] = buildClipWords(doc, { m: words }, buildSegments(doc.clips));
    expect(cw.views[0].tlStart).toBeCloseTo(0.5, 6);
    expect(cw.views[0].tlEnd).toBeCloseTo(0.7, 6);
    expect(cw.views[1].tlStart).toBeCloseTo(1.5, 6);
    expect(cw.views[1].tlEnd).toBeCloseTo(1.8, 6);
  });

  it('chains atempo below half speed', () => {
    expect(atempo(2)).toBe('atempo=2');
    expect(atempo(0.5)).toBe('atempo=0.5');
    expect(atempo(0.25)).toBe('atempo=0.5,atempo=0.5');
  });
});

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasFfmpeg)('clip speed in the export (FFmpeg)', () => {
  it('renders a fast and a slow clip with audio and video of the same length', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'verticut-speed-'));
    try {
      const src = path.join(dir, 'src.mp4');
      const work = path.join(dir, 'work');
      mkdirSync(work, { recursive: true });
      // 3 s red, then 3 s blue, with a tone.
      execFileSync('ffmpeg', [
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=red:s=540x960:r=30:d=3',
        '-f', 'lavfi', '-i', 'color=c=blue:s=540x960:r=30:d=3',
        '-f', 'lavfi', '-i', 'sine=f=440:d=6',
        '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
        '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src,
      ]); // prettier-ignore
      const doc = createProjectDoc('p', 'Velocidad', 'es');
      doc.subtitles.enabled = false;
      // The whole file at 2x (3 s: red until 1.5 s), then its last 2 s at a quarter of the speed (8 s, blue).
      doc.clips = [clip('fast', 0, 6, 2), clip('slow', 4, 6, 0.25)];
      const media = new Map<string, PlanMedia>([['m', { id: 'm', kind: 'video', sourcePath: src, hasAudio: true, width: 540, height: 960 }]]);
      const plan = buildExportPlan(doc, media, {});
      expect(plan.duration).toBeCloseTo(11, 6);
      const out = path.join(dir, 'out.mp4');
      await renderPlan(plan, out, work, 'fast', () => undefined);

      const count = (stream: string, entry: string) =>
        Number(
          execFileSync('ffprobe', [
            '-v',
            'error',
            '-select_streams',
            stream,
            '-count_frames',
            '-show_entries',
            `stream=${entry}`,
            '-of',
            'csv=p=0',
            out,
          ])
            .toString()
            .trim()
            .split(',')[0],
        );
      expect(count('v:0', 'nb_read_frames')).toBe(330);
      expect(Math.abs(count('a:0', 'duration') - 11)).toBeLessThan(0.05);

      const pixel = (t: number) => {
        const raw = execFileSync('ffmpeg', [
          '-v',
          'error',
          '-ss',
          String(t),
          '-i',
          out,
          '-frames:v',
          '1',
          '-vf',
          'scale=2:2',
          '-f',
          'rawvideo',
          '-pix_fmt',
          'rgb24',
          '-',
        ]);
        return raw[0] > raw[2] ? 'red' : 'blue';
      };
      expect(pixel(1.3)).toBe('red'); // at 2x the red half ends at 1.5 s
      expect(pixel(1.7)).toBe('blue');
      expect(pixel(9)).toBe('blue');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
