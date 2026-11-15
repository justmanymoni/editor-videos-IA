import { describe, expect, it } from 'vitest';
import { TEXT_ANIMATIONS, textAnimTimes, textMotion, textPose } from '../src/lib/shared/text-anim';
import { TEXT_PRESETS } from '../src/lib/shared/text-presets';
import { SUBTITLE_FONTS } from '../src/lib/shared/fonts';
import { byLayer, layoutLanes, moveToRow } from '../src/lib/shared/lanes';

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
  const item = (id: string, start: number, duration: number, lane?: number) => ({ id, start, duration, lane });
  const rows = (items: ReturnType<typeof item>[], options?: Parameters<typeof layoutLanes>[1]) => Object.fromEntries(layoutLanes(items, options).of);

  it('keeps items that do not overlap on one row', () => {
    const lanes = layoutLanes([item('a', 0, 1), item('b', 1, 1), item('c', 2.5, 1)]);
    expect(lanes.count).toBe(1);
    expect([...lanes.of.values()]).toEqual([0, 0, 0]);
  });

  it('puts overlapping items of a lane on neighbouring rows and reuses a row when it is free', () => {
    const lanes = layoutLanes([item('title', 0, 4), item('label', 1, 2), item('box', 1.5, 1), item('later', 3, 1)]);
    expect(lanes.count).toBe(3);
    expect(Object.fromEntries(lanes.of)).toEqual({ title: 0, label: 1, box: 2, later: 1 });
  });

  it('always has one row, even when empty', () => {
    expect(layoutLanes([]).count).toBe(1);
  });

  it('keeps a higher lane above a lower one, whatever their times', () => {
    expect(rows([item('top', 0, 1, 5), item('bottom', 3, 1, 2)])).toEqual({ bottom: 0, top: 1 });
    // Two overlapping items on the lower lane push the upper lane further up.
    expect(rows([item('a', 0, 2, 0), item('b', 1, 2, 0), item('c', 0, 1, 1)])).toEqual({ a: 0, b: 1, c: 2 });
  });

  it('reserves the first row of the text track for the subtitles', () => {
    const options = { defaultLane: 1, reserved: true };
    expect(rows([item('title', 0, 2)], options)).toEqual({ title: 1 });
    expect(layoutLanes([item('title', 0, 2)], options).count).toBe(2);
    // A text the user dragged down shares the subtitles' row.
    expect(rows([item('title', 0, 2), item('note', 0, 2, 0)], options)).toEqual({ note: 0, title: 1 });
    expect(layoutLanes([], options).count).toBe(1);
  });

  it('draws the lowest layer first', () => {
    const items = [item('front', 0, 5, 2), item('back', 0, 5, 0), item('middle', 1, 5, 1)];
    expect(byLayer(items).map((x) => x.id)).toEqual(['back', 'middle', 'front']);
  });

  it('moves an item to another layer by dragging', () => {
    const items = [item('a', 0, 4, 0), item('b', 0, 4, 1), item('c', 6, 2, 0)];
    const apply = (id: string, row: number) => {
      const lanes = moveToRow(items, id, row);
      return rows(items.map((x) => ({ ...x, lane: lanes.get(x.id) })));
    };
    // Above everything: a new top layer.
    expect(apply('a', 2)).toEqual({ c: 0, b: 1, a: 2 });
    // Onto a row with room at that time: it joins the row.
    expect(apply('c', 1)).toEqual({ a: 0, b: 1, c: 1 });
    // Onto a row that is taken at that time: a new row opens above (it was moved up)…
    expect(apply('a', 1)).toEqual({ c: 0, b: 1, a: 2 });
    // …or below (it was moved down): the row it landed on moves up as a whole.
    expect(apply('b', 0)).toEqual({ b: 0, a: 1, c: 1 });
  });
});
