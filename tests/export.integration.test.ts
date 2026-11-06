/**
 * Renders a real MP4 with FFmpeg and checks it is frame exact.
 * Skipped automatically when FFmpeg is not installed.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProjectDoc, type ProjectDoc, type Word } from '@/lib/shared/types';
import { buildExportPlan, renderPlan, type PlanMedia } from '@/lib/server/export';

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const ff = (...args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const probe = (file: string, entries: string, stream?: string) =>
  execFileSync('ffprobe', [
    '-v',
    'error',
    ...(stream ? ['-select_streams', stream] : []),
    '-count_frames',
    '-show_entries',
    entries,
    '-of',
    'default=nw=1',
    file,
  ]).toString();

describe.skipIf(!hasFfmpeg)('export (FFmpeg)', () => {
  it('renders 1080x1920 at 30 fps with exact cuts, b-roll, music and subtitles', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'verticut-test-'));
    try {
      const v1 = path.join(dir, 'v1.mp4');
      const v2 = path.join(dir, 'v2.mp4');
      const img = path.join(dir, 'img.png');
      const mus = path.join(dir, 'mus.mp3');
      ff(
        '-f',
        'lavfi',
        '-i',
        'testsrc2=s=1280x720:r=25:d=10',
        '-f',
        'lavfi',
        '-i',
        'sine=f=300:d=10',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-c:a',
        'aac',
        '-shortest',
        v1,
      );
      ff('-f', 'lavfi', '-i', 'testsrc=s=1080x1920:r=30:d=4', '-c:v', 'libx264', '-preset', 'ultrafast', v2);
      ff('-f', 'lavfi', '-i', 'color=c=red:s=600x600', '-frames:v', '1', img);
      ff('-f', 'lavfi', '-i', 'sine=f=500:d=20', '-c:a', 'libmp3lame', mus);

      const media = new Map<string, PlanMedia>([
        ['m1', { id: 'm1', kind: 'video', sourcePath: v1, hasAudio: true }],
        ['m2', { id: 'm2', kind: 'video', sourcePath: v2, hasAudio: false }],
        ['img', { id: 'img', kind: 'image', sourcePath: img, hasAudio: false }],
        ['mus', { id: 'mus', kind: 'audio', sourcePath: mus, hasAudio: true }],
      ]);
      const words: Word[] = ['Hola', 'esto', 'es', 'una', 'prueba'].map((text, i) => ({
        id: `w${i}`,
        text,
        start: 0.2 + i * 0.35,
        end: 0.5 + i * 0.35,
      }));
      const doc: ProjectDoc = {
        ...createProjectDoc('itest', 'Integración'),
        clips: [
          {
            id: 'c1',
            mediaId: 'm1',
            start: 0,
            end: 10,
            cuts: [
              { start: 2, end: 3.5, reason: 'silence' },
              { start: 6.2, end: 7.1, reason: 'manual' },
            ],
          },
          { id: 'c2', mediaId: 'm2', start: 0.5, end: 3, cuts: [] },
        ],
        broll: [{ id: 'b', mediaId: 'img', start: 3, duration: 1.5, srcIn: 0 }],
        audio: [{ id: 'a', mediaId: 'mus', start: 1, duration: 20, srcIn: 0, volume: 0.2, fadeIn: 0.5, fadeOut: 0.5 }],
      };
      doc.settings.fitMode = 'blur';

      const plan = buildExportPlan(doc, media, { m1: words });
      const expected = 2 + (6.2 - 3.5) + (10 - 7.1) + 2.5;
      expect(plan.duration).toBeCloseTo(expected, 5);
      expect(plan.ass).toContain('Dialogue:');

      const out = path.join(dir, 'out.mp4');
      let last = 0;
      await renderPlan(plan, out, path.join(dir, 'work'), 'fast', (p) => (last = p));
      expect(last).toBeGreaterThan(0.9);

      const v = probe(out, 'stream=width,height,r_frame_rate,nb_read_frames', 'v:0');
      expect(v).toContain('width=1080');
      expect(v).toContain('height=1920');
      expect(v).toContain('r_frame_rate=30/1');
      expect(Number(/nb_read_frames=(\d+)/.exec(v)![1])).toBe(Math.round(expected * 30));
      const a = probe(out, 'stream=duration', 'a:0');
      expect(Math.abs(Number(/duration=([\d.]+)/.exec(a)![1]) - expected)).toBeLessThan(0.05);

      // Subtitle pixels: the active word is yellow at the subtitle position.
      const raw = execFileSync('ffmpeg', [
        '-v',
        'error',
        '-ss',
        '0.4',
        '-i',
        out,
        '-frames:v',
        '1',
        '-vf',
        'crop=1080:300:0:1230',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        'pipe:1',
      ]);
      let yellow = 0;
      for (let i = 0; i < raw.length; i += 3) if (raw[i] > 220 && raw[i + 1] > 200 && raw[i + 2] < 80) yellow++;
      expect(yellow).toBeGreaterThan(500);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
