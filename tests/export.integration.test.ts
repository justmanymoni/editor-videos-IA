/**
 * Renders a real MP4 with FFmpeg and checks it is frame exact.
 * Skipped automatically when FFmpeg is not installed.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_TEXT, createProjectDoc, type ProjectDoc, type Word } from '@/lib/shared/types';
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
      const voiceStem = path.join(dir, 'voice.flac');
      const musicStem = path.join(dir, 'music.flac');
      const photo = path.join(dir, 'photo.png');
      const sticker = path.join(dir, 'sticker.png');
      const work = path.join(dir, 'work');
      mkdirSync(work, { recursive: true });
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
      ff('-f', 'lavfi', '-i', 'color=c=blue:s=800x600', '-frames:v', '1', photo);
      ff('-f', 'lavfi', '-i', 'color=c=lime:s=200x200', '-frames:v', '1', sticker);
      ff('-f', 'lavfi', '-i', 'color=c=magenta:s=300x100', '-frames:v', '1', path.join(work, 'text-0.png'));
      ff('-f', 'lavfi', '-i', 'sine=f=700:d=10', '-ac', '2', '-ar', '44100', '-c:a', 'flac', voiceStem);
      ff('-f', 'lavfi', '-i', 'sine=f=900:d=10', '-ac', '2', '-ar', '44100', '-c:a', 'flac', musicStem);

      const media = new Map<string, PlanMedia>([
        ['m1', { id: 'm1', kind: 'video', sourcePath: v1, hasAudio: true, stems: { voice: voiceStem, music: musicStem } }],
        ['m2', { id: 'm2', kind: 'video', sourcePath: v2, hasAudio: false }],
        ['img', { id: 'img', kind: 'image', sourcePath: img, hasAudio: false }],
        ['photo', { id: 'photo', kind: 'image', sourcePath: photo, hasAudio: false, width: 800, height: 600 }],
        ['sticker', { id: 'sticker', kind: 'image', sourcePath: sticker, hasAudio: false, width: 200, height: 200 }],
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
          // A photo as the last main clip (2 s).
          { id: 'c3', mediaId: 'photo', start: 0, end: 2, cuts: [] },
        ],
        broll: [
          { id: 'b', mediaId: 'img', start: 3, duration: 1.5, srcIn: 0 },
          // A sticker: small, top-left quarter, over the photo.
          { id: 's', mediaId: 'sticker', start: 10.3, duration: 1.5, srcIn: 0, x: 0.25, y: 0.2, scale: 0.2 },
        ],
        texts: [{ ...DEFAULT_TEXT, id: 't', start: 10.3, duration: 1.5, x: 0.5, y: 0.9 }],
        audio: [{ id: 'a', mediaId: 'mus', start: 1, duration: 20, srcIn: 0, volume: 0.2, fadeIn: 0.5, fadeOut: 0.5 }],
      };
      doc.settings.fitMode = 'blur';
      doc.audioMix = { m1: { voice: 1, music: 0 } };

      const plan = buildExportPlan(doc, media, { m1: words }, [{ id: 't', file: 'text-0.png', width: 300, height: 100 }]);
      const expected = 2 + (6.2 - 3.5) + (10 - 7.1) + 2.5 + 2;
      expect(plan.duration).toBeCloseTo(expected, 5);
      expect(plan.ass).toContain('Dialogue:');
      expect(plan.filter).toContain('volume=0[sm0]');

      const out = path.join(dir, 'out.mp4');
      let last = 0;
      await renderPlan(plan, out, work, 'fast', (p) => (last = p));
      expect(last).toBeGreaterThan(0.9);

      const v = probe(out, 'stream=width,height,r_frame_rate,nb_read_frames', 'v:0');
      expect(v).toContain('width=1080');
      expect(v).toContain('height=1920');
      expect(v).toContain('r_frame_rate=30/1');
      expect(Number(/nb_read_frames=(\d+)/.exec(v)![1])).toBe(Math.round(expected * 30));
      const a = probe(out, 'stream=duration', 'a:0');
      expect(Math.abs(Number(/duration=([\d.]+)/.exec(a)![1]) - expected)).toBeLessThan(0.05);

      // Audio mix: the voice stem (700 Hz) is heard, the music stem (900 Hz) is muted.
      const pcm = execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.5', '-t', '1', '-i', out, '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1']);
      const power = (f: number) => {
        let re = 0;
        let im = 0;
        for (let i = 0; i < pcm.length / 2; i++) {
          const x = pcm.readInt16LE(i * 2);
          re += x * Math.cos((2 * Math.PI * f * i) / 8000);
          im += x * Math.sin((2 * Math.PI * f * i) / 8000);
        }
        return re * re + im * im;
      };
      expect(power(700)).toBeGreaterThan(100 * power(900));

      // Photo clip with a sticker and a manual text on top (frame at 11 s).
      const frame = execFileSync(
        'ffmpeg',
        ['-v', 'error', '-ss', '11', '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
        {
          maxBuffer: 16 * 1024 * 1024,
        },
      );
      const px = (x: number, y: number) => [...frame.subarray((y * 1080 + x) * 3, (y * 1080 + x) * 3 + 3)];
      const [pr, pg, pb] = px(540, 960); // photo: blue
      expect(pb).toBeGreaterThan(200);
      expect(pr + pg).toBeLessThan(80);
      const [sr, sg, sb] = px(270, 384); // sticker: green, centred at 25 % / 20 %
      expect(sg).toBeGreaterThan(200);
      expect(sr + sb).toBeLessThan(80);
      const [tr, tg, tb] = px(540, 1728); // text image: magenta at 50 % / 90 %
      expect(tr).toBeGreaterThan(200);
      expect(tb).toBeGreaterThan(200);
      expect(tg).toBeLessThan(60);
      expect(px(540, 1728 - 80)[1]).toBeLessThan(60); // outside the 100 px tall text image: still the photo

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
