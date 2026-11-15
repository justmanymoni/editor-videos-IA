import { describe, expect, it } from 'vitest';
import { layoutCurve, overlayRect } from '@/lib/shared/text-curve';
import { splitItem, trimItemAt } from '@/lib/shared/edit';

describe('curved text', () => {
  const adv = new Array(12).fill(50);

  it('lays a semicircle out on a circle of the right radius, letters tangent to it', () => {
    const g = layoutCurve(adv, 'arc', 50, 100);
    const radius = 600 / Math.PI;
    // Symmetric, highest in the middle, ends lower (bends up like ∩).
    expect(g[0].x).toBeCloseTo(-g[11].x, 6);
    expect(g[5].y).toBeLessThan(g[0].y);
    expect(g[0].rot).toBeLessThan(0);
    expect(g[11].rot).toBeGreaterThan(0);
    // Every letter sits at distance `radius` from the common centre.
    const cy = g[5].y + radius * Math.cos(g[5].rot);
    for (const p of g) expect(Math.hypot(p.x, p.y - cy)).toBeCloseTo(radius, 4);
  });

  it('closes a full circle and flips when bending down', () => {
    const circle = layoutCurve(adv, 'arc', 100, 100);
    const span = Math.abs(circle[11].rot - circle[0].rot);
    expect(span).toBeCloseTo(2 * Math.PI * (11 / 12), 6);
    const down = layoutCurve(adv, 'arc', -50, 100);
    expect(down[5].y).toBeGreaterThan(down[0].y);
  });

  it('follows a sine wave', () => {
    const g = layoutCurve(adv, 'wave', 100, 100);
    expect(Math.max(...g.map((p) => p.y))).toBeGreaterThan(60);
    expect(Math.min(...g.map((p) => p.y))).toBeLessThan(-60);
    expect(g[0].x).toBeLessThan(g[11].x);
  });
});

describe('overlay geometry', () => {
  it('covers the frame at scale 1 and shrinks around its centre', () => {
    expect(overlayRect(1920, 1080, 1080, 1920)).toEqual({
      width: 1920 * (1920 / 1080),
      height: 1920,
      left: 540 - (1920 * (1920 / 1080)) / 2,
      top: 0,
    });
    const small = overlayRect(500, 500, 1080, 1920, 0.25, 0.75, 0.2);
    expect(small.width).toBeCloseTo(384);
    expect(small.left + small.width / 2).toBeCloseTo(270);
    expect(small.top + small.height / 2).toBeCloseTo(1440);
  });
});

describe('timeline items', () => {
  const id = () => 'new';
  it('splits and trims text items without a source offset', () => {
    const text = { id: 't', start: 2, duration: 4 };
    const [a, b] = splitItem(text, 3, id)!;
    expect(a).toEqual({ id: 't', start: 2, duration: 1 });
    expect(b).toEqual({ id: 'new', start: 3, duration: 3 });
    expect(trimItemAt(text, 3, 'left')).toEqual({ id: 't', start: 3, duration: 3 });
    expect(trimItemAt(text, 3, 'right')).toEqual({ id: 't', start: 2, duration: 1 });
    expect(trimItemAt(text, 10, 'left')).toBeNull();
  });

  it('keeps audio in sync when trimming its start', () => {
    expect(trimItemAt({ id: 'a', start: 1, duration: 5, srcIn: 2 }, 3, 'left')).toEqual({ id: 'a', start: 3, duration: 3, srcIn: 4 });
  });
});
