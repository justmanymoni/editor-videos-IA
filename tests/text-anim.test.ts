import { describe, expect, it } from 'vitest';
import { TEXT_ANIMATIONS, textAnimTimes, textMotion, textPose } from '../src/lib/shared/text-anim';
import { TEXT_PRESETS } from '../src/lib/shared/text-presets';
import { SUBTITLE_FONTS } from '../src/lib/shared/fonts';
import { assignLanes } from '../src/lib/shared/lanes';

/** Evaluates an FFmpeg expression of `t` with the handful of functions the export uses. */
function ffmpegExpr(expr: string | null, t: number, fallback: number): number {
  if (!expr) return fallback;
  const js = expr.replace(/\bif\(/g, 'iff(');
  const fn = new Function('t', 'clip', 'pow', 'lt', 'iff', `return ${js};`);
  return fn(
    t,
    (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v)),
    Math.pow,
    (a: number, b: number) => (a < b ? 1 : 0),
    (c: number, a: number, b: number) => (c ? a : b),
  );
}

const kinds = TEXT_ANIMATIONS.map((a) => a.value);

describe('text animations', () => {
  it('rests in place between the entrance and the exit', () => {
    for (const animIn of kinds) {
      for (const animOut of kinds) {
        const pose = textPose({ animIn, animOut }, 1, 2);
        expect(pose).toEqual({ opacity: 1, dx: 0, dy: 0, scale: 1 });
      }
    }
  });

  it('starts hidden or small and ends hidden', () => {
    expect(textPose({ animIn: 'fade', animOut: 'none' }, 0, 2).opacity).toBe(0);
    expect(textPose({ animIn: 'zoom', animOut: 'none' }, 0, 2).scale).toBeCloseTo(0.55);
    expect(textPose({ animIn: 'pop', animOut: 'none' }, 0, 2)).toMatchObject({ opacity: 1, scale: 0.5 });
    expect(textPose({ animIn: 'slide-up', animOut: 'none' }, 0, 2).dy).toBeGreaterThan(100); // comes from below
    expect(textPose({ animIn: 'none', animOut: 'slide-up' }, 2, 2).dy).toBeLessThan(-100); // leaves upwards
    expect(textPose({ animIn: 'none', animOut: 'fade' }, 2, 2).opacity).toBe(0);
  });

  it('is shortened for very short texts', () => {
    const { inDur, outDur } = textAnimTimes({ animIn: 'fade', animOut: 'fade' }, 0.4);
    expect(inDur + outDur).toBeLessThan(0.4);
    expect(textAnimTimes({ animIn: 'none', animOut: 'none' }, 2)).toEqual({ inDur: 0, outDur: 0 });
  });

  it('moves the same in the export (FFmpeg expressions) as in the preview', () => {
    const start = 3;
    const end = 5.2;
    for (const animIn of kinds) {
      for (const animOut of kinds) {
        const item = { animIn, animOut };
        const motion = textMotion(item, start, end);
        for (let t = start; t <= end; t += 1 / 30) {
          const pose = textPose(item, t - start, end - start);
          expect(ffmpegExpr(motion.scale, t, 1), `${animIn}/${animOut} scale @${t}`).toBeCloseTo(pose.scale, 3);
          expect(ffmpegExpr(motion.dx, t, 0), `${animIn}/${animOut} dx @${t}`).toBeCloseTo(pose.dx, 1);
          expect(ffmpegExpr(motion.dy, t, 0), `${animIn}/${animOut} dy @${t}`).toBeCloseTo(pose.dy, 1);
        }
        const { inDur, outDur } = textAnimTimes(item, end - start);
        expect(motion.fadeIn).toBe(inDur > 0 && animIn !== 'pop' ? `t=in:st=3:d=${inDur}:alpha=1` : null);
        expect(motion.fadeOut).toBe(outDur > 0 ? `t=out:st=${end - outDur}:d=${outDur}:alpha=1` : null);
      }
    }
  });
});

describe('text presets', () => {
  it('use fonts and animations that exist', () => {
    const fonts = new Set(SUBTITLE_FONTS.map((f) => f.id));
    expect(new Set(TEXT_PRESETS.map((p) => p.id)).size).toBe(TEXT_PRESETS.length);
    for (const p of TEXT_PRESETS) {
      expect(fonts.has(p.style.fontId ?? ''), p.id).toBe(true);
      expect(kinds).toContain(p.style.animIn ?? 'none');
      expect(kinds).toContain(p.style.animOut ?? 'none');
      expect(p.sample.trim().length).toBeGreaterThan(0);
      // The box is only drawn behind straight text.
      if (p.style.bgColor) expect(p.style.curve ?? 'none').toBe('none');
    }
  });
});

describe('layers of a track', () => {
  const item = (id: string, start: number, duration: number) => ({ id, start, duration });

  it('keeps items that do not overlap on one row', () => {
    const lanes = assignLanes([item('a', 0, 1), item('b', 1, 1), item('c', 2.5, 1)]);
    expect(lanes.count).toBe(1);
    expect([...lanes.of.values()]).toEqual([0, 0, 0]);
  });

  it('puts overlapping items on separate rows and reuses a row when it is free', () => {
    const lanes = assignLanes([item('title', 0, 4), item('label', 1, 2), item('box', 1.5, 1), item('later', 3, 1)]);
    expect(lanes.count).toBe(3);
    expect(lanes.of.get('title')).toBe(0);
    expect(lanes.of.get('label')).toBe(1);
    expect(lanes.of.get('box')).toBe(2);
    expect(lanes.of.get('later')).toBe(1);
  });

  it('always has one row, even when empty', () => {
    expect(assignLanes([]).count).toBe(1);
  });
});
