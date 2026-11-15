/**
 * Entrance and exit animations of the manual texts, described once: the
 * preview applies `textPose` with CSS and the export builds the same motion
 * as FFmpeg expressions (`textMotion`).
 */
import type { TextAnimation, TextItem } from './types';

/** Entrance / exit length in seconds (shortened for very short texts). */
export const TEXT_IN = 0.35;
export const TEXT_OUT = 0.25;
/** How far a sliding text travels, in frame pixels. */
export const TEXT_SLIDE = 220;

export const TEXT_ANIMATIONS: { value: TextAnimation; label: string; out: string }[] = [
  { value: 'none', label: 'Ninguna', out: 'Ninguna' },
  { value: 'fade', label: 'Desvanecer', out: 'Desvanecer' },
  { value: 'zoom', label: 'Agrandar', out: 'Encoger' },
  { value: 'zoom-out', label: 'Encoger', out: 'Agrandar' },
  { value: 'pop', label: 'Rebote', out: 'Rebote' },
  { value: 'slide-up', label: 'Subir', out: 'Subir' },
  { value: 'slide-down', label: 'Bajar', out: 'Bajar' },
  { value: 'slide-left', label: 'Desde la derecha', out: 'Hacia la izquierda' },
  { value: 'slide-right', label: 'Desde la izquierda', out: 'Hacia la derecha' },
];

type Animated = Pick<TextItem, 'animIn' | 'animOut'>;

export interface TextPose {
  opacity: number;
  dx: number;
  dy: number;
  scale: number;
}

export function textAnimTimes(item: Animated, duration: number) {
  return {
    inDur: item.animIn === 'none' ? 0 : Math.min(TEXT_IN, duration * 0.45),
    outDur: item.animOut === 'none' ? 0 : Math.min(TEXT_OUT, duration * 0.35),
  };
}

/** Direction of travel of the slides: the text moves that way both when it enters and when it leaves. */
function direction(a: TextAnimation): { x: number; y: number } {
  if (a === 'slide-left') return { x: -1, y: 0 };
  if (a === 'slide-right') return { x: 1, y: 0 };
  if (a === 'slide-up') return { x: 0, y: -1 };
  if (a === 'slide-down') return { x: 0, y: 1 };
  return { x: 0, y: 0 };
}

const clip01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (k: number) => 1 - (1 - k) ** 3;
const easeIn = (k: number) => k ** 3;
/** Overshoots to 112 % and settles. */
const bounce = (k: number) => (k < 0.6 ? 0.5 + 0.62 * (k / 0.6) : 1.12 - 0.12 * ((k - 0.6) / 0.4));

/** Scale at the start of the entrance and at the end of the exit. */
const IN_SCALE: Partial<Record<TextAnimation, number>> = { zoom: 0.55, 'zoom-out': 1.6 };
const OUT_SCALE: Partial<Record<TextAnimation, number>> = { zoom: 0.55, 'zoom-out': 1.6, pop: 0.5 };

/** Pose of a text `t` seconds after it appears, for a text that lasts `duration` seconds. */
export function textPose(item: Animated, t: number, duration: number): TextPose {
  const { inDur, outDur } = textAnimTimes(item, duration);
  const pose: TextPose = { opacity: 1, dx: 0, dy: 0, scale: 1 };
  if (inDur > 0) {
    const k = clip01(t / inDur);
    const a = item.animIn;
    if (a !== 'pop') pose.opacity *= k;
    const d = direction(a);
    // It arrives from the opposite side of its direction of travel.
    pose.dx -= d.x * TEXT_SLIDE * (1 - easeOut(k));
    pose.dy -= d.y * TEXT_SLIDE * (1 - easeOut(k));
    if (a === 'pop') pose.scale *= bounce(k);
    else if (IN_SCALE[a] !== undefined) pose.scale *= IN_SCALE[a] + (1 - IN_SCALE[a]) * easeOut(k);
  }
  if (outDur > 0) {
    const k = clip01((t - (duration - outDur)) / outDur);
    const a = item.animOut;
    pose.opacity *= 1 - k;
    const d = direction(a);
    pose.dx += d.x * TEXT_SLIDE * easeIn(k);
    pose.dy += d.y * TEXT_SLIDE * easeIn(k);
    if (OUT_SCALE[a] !== undefined) pose.scale *= 1 + (OUT_SCALE[a] - 1) * easeIn(k);
  }
  return pose;
}

const n = (v: number) => String(Math.round(v * 10000) / 10000);

/**
 * The same motion as FFmpeg expressions of the output time `t`, for a text
 * shown from `start` to `end`. `scale` multiplies the size, `dx` / `dy` are
 * added to the position; null means "does not change". The fades are
 * arguments for the `fade` filter (alpha only).
 */
export function textMotion(
  item: Animated,
  start: number,
  end: number,
): { scale: string | null; dx: string | null; dy: string | null; fadeIn: string | null; fadeOut: string | null } {
  const duration = end - start;
  const { inDur, outDur } = textAnimTimes(item, duration);
  const kIn = `clip((t-${n(start)})/${n(inDur || 1)},0,1)`;
  const kOut = `clip((t-${n(end - outDur)})/${n(outDur || 1)},0,1)`;
  const outIn = `(1-pow(1-${kIn},3))`;
  const inOut = `pow(${kOut},3)`;
  const scales: string[] = [];
  const dxs: string[] = [];
  const dys: string[] = [];
  if (inDur > 0) {
    const a = item.animIn;
    const d = direction(a);
    if (d.x) dxs.push(`(${n(-d.x * TEXT_SLIDE)})*(1-${outIn})`);
    if (d.y) dys.push(`(${n(-d.y * TEXT_SLIDE)})*(1-${outIn})`);
    if (a === 'pop') scales.push(`if(lt(${kIn},0.6),0.5+0.62*${kIn}/0.6,1.12-0.12*(${kIn}-0.6)/0.4)`);
    else if (IN_SCALE[a] !== undefined) scales.push(`(${n(IN_SCALE[a])}+${n(1 - IN_SCALE[a])}*${outIn})`);
  }
  if (outDur > 0) {
    const a = item.animOut;
    const d = direction(a);
    if (d.x) dxs.push(`(${n(d.x * TEXT_SLIDE)})*${inOut}`);
    if (d.y) dys.push(`(${n(d.y * TEXT_SLIDE)})*${inOut}`);
    if (OUT_SCALE[a] !== undefined) scales.push(`(1+(${n(OUT_SCALE[a] - 1)})*${inOut})`);
  }
  return {
    scale: scales.length ? scales.join('*') : null,
    dx: dxs.length ? dxs.join('+') : null,
    dy: dys.length ? dys.join('+') : null,
    fadeIn: inDur > 0 && item.animIn !== 'pop' ? `t=in:st=${n(start)}:d=${n(inDur)}:alpha=1` : null,
    fadeOut: outDur > 0 ? `t=out:st=${n(end - outDur)}:d=${n(outDur)}:alpha=1` : null,
  };
}
