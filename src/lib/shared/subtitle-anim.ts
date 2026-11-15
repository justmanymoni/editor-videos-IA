/**
 * Subtitle animations, described once so the preview (CSS) and the export
 * (ASS override tags) move the same way. All motion is linear, as in ASS.
 */
import type { SubtitleAnimation, SubtitleStyle } from './types';

/** Entrance / exit length in seconds (shortened for very short blocks). */
export const ANIM_IN = 0.28;
export const ANIM_OUT = 0.2;
/** How far a sliding block travels, in frame pixels. */
export const SLIDE_DISTANCE = 150;
/** Per-letter animations: delay between letters and how long each letter takes to settle. */
export const LETTER_STEP = 0.04;
export const LETTER_SETTLE = 0.18;
export const DROP_SCALE = 1.8;

export const ANIMATIONS: { value: SubtitleAnimation; label: string }[] = [
  { value: 'none', label: 'Ninguna' },
  { value: 'fade', label: 'Desvanecer' },
  { value: 'slide-left', label: 'Deslizar a la izquierda' },
  { value: 'slide-right', label: 'Deslizar a la derecha' },
  { value: 'slide-up', label: 'Deslizar arriba' },
  { value: 'slide-down', label: 'Deslizar abajo' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'pop', label: 'Rebote' },
  { value: 'blur', label: 'Desenfoque' },
  { value: 'rotate', label: 'Giro' },
  { value: 'typewriter', label: 'Máquina de escribir' },
  { value: 'drop', label: 'Caída de letras' },
];

export const isLetterAnimation = (a: SubtitleAnimation) => a === 'typewriter' || a === 'drop';

/** Entrance and exit lengths for a block lasting `duration` seconds. */
export function animTimes(style: Pick<SubtitleStyle, 'animationIn' | 'animationOut'>, duration: number) {
  return {
    inDur: style.animationIn === 'none' || isLetterAnimation(style.animationIn) ? 0 : Math.min(ANIM_IN, duration * 0.5),
    outDur: style.animationOut === 'fade' ? Math.min(ANIM_OUT, duration * 0.3) : 0,
  };
}

/** Delay between letters so that the whole block is written within 60 % of its time. */
export const letterStep = (letters: number, duration: number) => Math.min(LETTER_STEP, (duration * 0.6) / Math.max(1, letters));

/** Where a sliding block starts, relative to its final position. */
export function slideOffset(a: SubtitleAnimation): { x: number; y: number } {
  if (a === 'slide-left') return { x: SLIDE_DISTANCE, y: 0 };
  if (a === 'slide-right') return { x: -SLIDE_DISTANCE, y: 0 };
  if (a === 'slide-up') return { x: 0, y: SLIDE_DISTANCE };
  if (a === 'slide-down') return { x: 0, y: -SLIDE_DISTANCE };
  return { x: 0, y: 0 };
}

export interface BlockPose {
  opacity: number;
  dx: number;
  dy: number;
  scale: number;
  /** Degrees, clockwise. */
  rotate: number;
  blur: number;
}

/** Pose of the whole block `t` seconds after it appears (`remaining` seconds before it ends). */
export function blockPose(style: Pick<SubtitleStyle, 'animationIn' | 'animationOut'>, t: number, remaining: number, duration: number): BlockPose {
  const { inDur, outDur } = animTimes(style, duration);
  const pose: BlockPose = { opacity: 1, dx: 0, dy: 0, scale: 1, rotate: 0, blur: 0 };
  const a = style.animationIn;
  if (inDur > 0 && t < inDur) {
    const k = Math.max(0, t / inDur);
    const fades = a !== 'pop';
    if (fades) pose.opacity = k;
    const off = slideOffset(a);
    pose.dx = off.x * (1 - k);
    pose.dy = off.y * (1 - k);
    if (a === 'zoom') pose.scale = 0.6 + 0.4 * k;
    if (a === 'pop') pose.scale = k < 0.6 ? 0.5 + (1.12 - 0.5) * (k / 0.6) : 1.12 - 0.12 * ((k - 0.6) / 0.4);
    if (a === 'rotate') pose.rotate = -14 * (1 - k);
    if (a === 'blur') pose.blur = 14 * (1 - k);
  }
  if (outDur > 0 && remaining < outDur) pose.opacity *= Math.max(0, remaining / outDur);
  return pose;
}

/** Pose of letter `index` for the per-letter animations. */
export function letterPose(a: SubtitleAnimation, index: number, step: number, t: number): { opacity: number; scale: number } {
  const local = t - index * step;
  if (local < 0) return { opacity: 0, scale: 1 };
  if (a === 'drop' && local < LETTER_SETTLE) return { opacity: 1, scale: DROP_SCALE - (DROP_SCALE - 1) * (local / LETTER_SETTLE) };
  return { opacity: 1, scale: 1 };
}
