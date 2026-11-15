/**
 * Renders subtitles with FFmpeg/libass and looks at the pixels, to check that
 * the timed highlight and the entrance animations really behave as designed.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_SUBTITLE_STYLE, type SubtitleStyle } from '@/lib/shared/types';
import { buildPages, type SubWord } from '@/lib/shared/subtitles';
import { buildAss } from '@/lib/shared/ass';
import { getFont } from '@/lib/shared/fonts';

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const word = (text: string, start: number, end: number): SubWord => ({ key: text, text, start, end, breakBefore: false, sentenceEnd: false });
// One block: three words, each "spoken" for half a second.
const WORDS = [word('UNO', 1, 1.45), word('DOS', 1.5, 1.95), word('TRES', 2, 2.45)];

/** Renders a frame at time t and returns, for each third of the frame width, how many yellow and white pixels the subtitle row has. */
function frameStats(dir: string, style: SubtitleStyle, t: number) {
  const pages = buildPages(WORDS, style);
  writeFileSync(path.join(dir, 'subs.ass'), buildAss(pages, style));
  const raw = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x202020:s=1080x1920:r=30:d=4',
      '-vf',
      'subtitles=subs.ass:fontsdir=fonts,crop=1080:400:0:1182',
      '-ss',
      String(t),
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ],
    { cwd: dir, maxBuffer: 8 * 1024 * 1024 },
  );
  const stats = { yellow: 0, white: 0, yellowMin: 1080, yellowMax: 0, whiteMin: 1080, whiteMax: 0 };
  for (let i = 0; i < raw.length; i += 3) {
    const x = (i / 3) % 1080;
    const [r, g, b] = [raw[i], raw[i + 1], raw[i + 2]];
    if (r > 200 && g > 190 && b < 90) {
      stats.yellow++;
      stats.yellowMin = Math.min(stats.yellowMin, x);
      stats.yellowMax = Math.max(stats.yellowMax, x);
    } else if (r > 200 && g > 200 && b > 200) {
      stats.white++;
      stats.whiteMin = Math.min(stats.whiteMin, x);
      stats.whiteMax = Math.max(stats.whiteMax, x);
    }
  }
  return {
    ...stats,
    total: stats.yellow + stats.white,
    minX: Math.min(stats.yellowMin, stats.whiteMin),
    maxX: Math.max(stats.yellowMax, stats.whiteMax),
  };
}

describe.skipIf(!hasFfmpeg)('subtitle rendering (libass)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'verticut-subs-'));
  mkdirSync(path.join(dir, 'fonts'));
  const font = getFont(DEFAULT_SUBTITLE_STYLE.fontId).file;
  copyFileSync(path.join(process.cwd(), 'public', 'fonts', font), path.join(dir, 'fonts', font));
  const style = { ...DEFAULT_SUBTITLE_STYLE, maxCharsPerLine: 30, fontSize: 70, shadow: 0 };

  it('highlights exactly the word being spoken', () => {
    const first = frameStats(dir, style, 1.2);
    expect(first.yellow).toBeGreaterThan(500);
    expect(first.yellowMax).toBeLessThan(first.whiteMin); // UNO is yellow, left of the white words
    const second = frameStats(dir, style, 1.7);
    expect(second.yellow).toBeGreaterThan(500);
    expect(second.whiteMin).toBeLessThan(second.yellowMin); // DOS in the middle
    expect(second.yellowMax).toBeLessThan(second.whiteMax);
    const third = frameStats(dir, style, 2.2);
    expect(third.yellowMin).toBeGreaterThan(third.whiteMax); // TRES at the right
  });

  it('keeps every word white when the highlight is off', () => {
    const s = frameStats(dir, { ...style, highlight: false }, 1.7);
    expect(s.yellow).toBe(0);
    expect(s.white).toBeGreaterThan(1500);
  });

  it('puts the spoken word in a box and dims the words to come', () => {
    const boxed = { ...style, highlightBox: true, dimUpcoming: true };
    const plain = frameStats(dir, style, 1.7);
    // DOS is being said: UNO was said (white), TRES is still to come (dimmed, so not white).
    const second = frameStats(dir, boxed, 1.7);
    expect(second.yellow).toBeGreaterThan(plain.yellow * 2); // a filled box, not only letters
    expect(second.whiteMax).toBeLessThan(second.yellowMin);
    // The box is where the highlighted word was, a little wider on both sides.
    expect(second.yellowMin).toBeLessThan(plain.yellowMin);
    expect(second.yellowMax).toBeGreaterThan(plain.yellowMax);
    expect(plain.yellowMin - second.yellowMin).toBeLessThan(40);
    expect(second.yellowMax - plain.yellowMax).toBeLessThan(40);
    // Without dimming, the word to come is white again, at the right of the box.
    const undimmed = frameStats(dir, { ...boxed, dimUpcoming: false }, 1.7);
    expect(undimmed.whiteMax).toBeGreaterThan(undimmed.yellowMax);
    // TRES is being said: everything before it is white.
    const third = frameStats(dir, boxed, 2.2);
    expect(third.whiteMax).toBeLessThan(third.yellowMin);
    // Letter animations still work with a box.
    expect(frameStats(dir, { ...boxed, animationIn: 'drop' }, 2.3).yellow).toBeGreaterThan(plain.yellow);
  });

  it('fades in, slides in and types letter by letter', () => {
    const full = frameStats(dir, { ...style, highlight: false }, 1.7);
    // Fade: half-way through the entrance the text is dim (no pure white yet), later it is complete.
    const fading = frameStats(dir, { ...style, highlight: false, animationIn: 'fade' }, 1.1);
    expect(fading.total).toBeLessThan(full.total * 0.2);
    expect(frameStats(dir, { ...style, highlight: false, animationIn: 'fade' }, 1.7).total).toBeGreaterThan(full.total * 0.9);
    // Slide to the left: starts displaced to the right and ends in place.
    const settled = frameStats(dir, { ...style, highlight: false, animationIn: 'slide-left' }, 1.7);
    expect(Math.abs(settled.minX - full.minX)).toBeLessThan(3);
    // Typewriter: after 60 ms only the first letters exist; later all of them.
    const typing = frameStats(dir, { ...style, highlight: false, animationIn: 'typewriter' }, 1.07);
    expect(typing.total).toBeGreaterThan(0);
    expect(typing.maxX).toBeLessThan(full.maxX - 300);
    expect(frameStats(dir, { ...style, highlight: false, animationIn: 'typewriter' }, 1.9).total).toBeGreaterThan(full.total * 0.95);
    // Drop: letters start bigger, so early on the text is wider than its final layout.
    const drop = frameStats(dir, { ...style, highlight: false, animationIn: 'drop' }, 1.9);
    expect(Math.abs(drop.maxX - full.maxX)).toBeLessThan(4);
    rmSync(dir, { recursive: true, force: true });
  });
});
