/**
 * Picture settings of a clip of the main track or an overlay (the "Vídeo" tab):
 * where it is drawn and how it is improved. The preview (CSS) and the export
 * (FFmpeg) take their numbers from here, so both show the same thing.
 */
import type { BlendMode, PictureSettings } from './types';
import { OUTPUT_HEIGHT, OUTPUT_WIDTH } from './types';
import { clamp } from './ranges';
import { overlayRect } from './text-curve';

/** Picture settings with every value filled in. */
export interface Picture {
  x: number;
  y: number;
  scale: number;
  scaleY: number;
  /** Width and height share one scale. */
  uniform: boolean;
  rotation: number;
  opacity: number;
  blend: BlendMode;
  stabilize: number;
  enhance: number;
  denoise: number;
  opticalFlow: boolean;
  upscale: boolean;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 8;

/** The modes offered, with their names in CSS (preview) and in FFmpeg's blend filter (export). */
export const BLEND_MODES: { value: BlendMode; label: string; css: string; ffmpeg: string }[] = [
  { value: 'normal', label: 'Normal', css: 'normal', ffmpeg: 'normal' },
  { value: 'screen', label: 'Pantalla', css: 'screen', ffmpeg: 'screen' },
  { value: 'multiply', label: 'Multiplicar', css: 'multiply', ffmpeg: 'multiply' },
  { value: 'overlay', label: 'Superponer', css: 'overlay', ffmpeg: 'overlay' },
  { value: 'lighten', label: 'Aclarar', css: 'lighten', ffmpeg: 'lighten' },
  { value: 'darken', label: 'Oscurecer', css: 'darken', ffmpeg: 'darken' },
  { value: 'hardlight', label: 'Luz fuerte', css: 'hard-light', ffmpeg: 'hardlight' },
  { value: 'difference', label: 'Diferencia', css: 'difference', ffmpeg: 'difference' },
];

export const blendMode = (mode: BlendMode) => BLEND_MODES.find((m) => m.value === mode) ?? BLEND_MODES[0];

const finite = (v: number | undefined, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export function pictureOf(p: PictureSettings): Picture {
  const scale = clamp(finite(p.scale, 1), MIN_SCALE, MAX_SCALE);
  const uniform = p.scaleY === undefined;
  return {
    x: finite(p.x, 0.5),
    y: finite(p.y, 0.5),
    scale,
    scaleY: uniform ? scale : clamp(finite(p.scaleY, scale), MIN_SCALE, MAX_SCALE),
    uniform,
    rotation: finite(p.rotation, 0),
    opacity: clamp(finite(p.opacity, 1), 0, 1),
    blend: BLEND_MODES.some((m) => m.value === p.blend) ? p.blend! : 'normal',
    stabilize: clamp(Math.round(finite(p.stabilize, 0)), 0, 3),
    enhance: clamp(finite(p.enhance, 0), 0, 1),
    denoise: clamp(finite(p.denoise, 0), 0, 1),
    opticalFlow: !!p.opticalFlow,
    upscale: !!p.upscale,
  };
}

/** Placed, sized and mixed as it comes: nothing of "Transformación" or "Mezcla" was touched. */
export const isPlainPicture = (p: Picture) =>
  p.x === 0.5 && p.y === 0.5 && p.scale === 1 && p.scaleY === 1 && p.rotation === 0 && p.opacity === 1 && p.blend === 'normal';

export const hasImprovements = (p: Picture) => p.stabilize > 0 || p.enhance > 0 || p.denoise > 0 || p.opticalFlow || p.upscale;

/** The settings that put a picture back as it comes (for the reset buttons). */
export const TRANSFORM_RESET: PictureSettings = { x: undefined, y: undefined, scale: undefined, scaleY: undefined, rotation: undefined };
export const MIX_RESET: PictureSettings = { opacity: undefined, blend: undefined };

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where a picture is drawn on the frame, before turning it. `contain` is for
 * the clips of a project with the blurred background: at scale 1 they fit
 * inside the frame instead of covering it.
 */
export function pictureRect(mediaWidth: number, mediaHeight: number, p: Picture, contain = false): Rect {
  return overlayRect(mediaWidth, mediaHeight, OUTPUT_WIDTH, OUTPUT_HEIGHT, p.x, p.y, p.scale, p.scaleY, contain);
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Size of the box that holds a rectangle turned by `deg`. */
export function turnedSize(width: number, height: number, deg: number) {
  const c = Math.abs(Math.cos(rad(deg)));
  const s = Math.abs(Math.sin(rad(deg)));
  return { width: width * c + height * s, height: width * s + height * c };
}

export type Align = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';

/** New centre that puts an edge (or the middle) of the turned picture on that of the frame. */
export function alignPicture(rect: Rect, rotation: number, align: Align): { x?: number; y?: number } {
  const box = turnedSize(rect.width, rect.height, rotation);
  switch (align) {
    case 'left':
      return { x: box.width / 2 / OUTPUT_WIDTH };
    case 'centerX':
      return { x: 0.5 };
    case 'right':
      return { x: 1 - box.width / 2 / OUTPUT_WIDTH };
    case 'top':
      return { y: box.height / 2 / OUTPUT_HEIGHT };
    case 'centerY':
      return { y: 0.5 };
    case 'bottom':
      return { y: 1 - box.height / 2 / OUTPUT_HEIGHT };
  }
}

export interface Placement {
  /** The part of the picture that can be seen, as fractions of it. */
  crop: { x: number; y: number; w: number; h: number };
  /** True when all of it is used. */
  whole: boolean;
  /** Size of that part on the frame, before turning it. */
  width: number;
  height: number;
  /** Where the centre of that part goes on the frame. */
  cx: number;
  cy: number;
}

/**
 * How to draw a picture with only the part of it that ends up inside the
 * frame: an enlarged clip would otherwise be scaled to thousands of pixels
 * just to throw most of them away. Returns null when nothing of it is seen.
 */
export function placePicture(rect: Rect, rotation: number, frameW = OUTPUT_WIDTH, frameH = OUTPUT_HEIGHT): Placement | null {
  const { width: w, height: h } = rect;
  if (w <= 0 || h <= 0) return null;
  const centreX = rect.left + w / 2;
  const centreY = rect.top + h / 2;
  const cos = Math.cos(rad(rotation));
  const sin = Math.sin(rad(rotation));
  // The corners of the frame as the picture sees them (relative to its centre, before the turn).
  const MARGIN = 2;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [qx, qy] of [
    [-MARGIN, -MARGIN],
    [frameW + MARGIN, -MARGIN],
    [-MARGIN, frameH + MARGIN],
    [frameW + MARGIN, frameH + MARGIN],
  ]) {
    const dx = qx - centreX;
    const dy = qy - centreY;
    const px = dx * cos + dy * sin;
    const py = -dx * sin + dy * cos;
    x0 = Math.min(x0, px);
    x1 = Math.max(x1, px);
    y0 = Math.min(y0, py);
    y1 = Math.max(y1, py);
  }
  x0 = Math.max(x0, -w / 2);
  x1 = Math.min(x1, w / 2);
  y0 = Math.max(y0, -h / 2);
  y1 = Math.min(y1, h / 2);
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  const whole = x1 - x0 >= w - 0.5 && y1 - y0 >= h - 0.5;
  const sx = (x0 + x1) / 2;
  const sy = (y0 + y1) / 2;
  return {
    crop: { x: (x0 + w / 2) / w, y: (y0 + h / 2) / h, w: (x1 - x0) / w, h: (y1 - y0) / h },
    whole,
    width: x1 - x0,
    height: y1 - y0,
    cx: centreX + sx * cos - sy * sin,
    cy: centreY + sx * sin + sy * cos,
  };
}

/** Contrast and colour of "Mejorar la calidad" (shared by the CSS preview and FFmpeg's eq). */
export const enhanceLevels = (amount: number) => ({ contrast: 1 + 0.14 * amount, saturation: 1 + 0.3 * amount, sharpen: 1.1 * amount });

const round = (v: number) => Math.round(v * 1000) / 1000;

/** CSS filter that shows "Mejorar la calidad" in the preview (the sharpening is only applied when exporting). */
export function cssFilter(p: Picture): string {
  if (p.enhance <= 0) return '';
  const e = enhanceLevels(p.enhance);
  return `contrast(${round(e.contrast)}) saturate(${round(e.saturation)})`;
}

/** Search radius of the stabilisation and how much the camera path is smoothed, by level. */
export const STABILIZE_LEVELS = [
  { label: 'Recorte mínimo', smoothing: 8, shake: 16 },
  { label: 'Recomendado', smoothing: 16, shake: 32 },
  { label: 'Más estable', smoothing: 30, shake: 64 },
];

/**
 * FFmpeg filters of the improvements: `denoise` goes on the source frames and
 * `finish` once the picture has its final size.
 */
export function improveFilters(p: Picture): { denoise: string | null; finish: string[] } {
  const d = p.denoise;
  const finish: string[] = [];
  if (p.enhance > 0) {
    const e = enhanceLevels(p.enhance);
    finish.push(`eq=contrast=${round(e.contrast)}:saturation=${round(e.saturation)}`, `unsharp=5:5:${round(e.sharpen)}:5:5:0`);
  }
  if (p.upscale) finish.push('unsharp=3:3:0.8:3:3:0');
  return {
    denoise: d > 0 ? `hqdn3d=${round(1.5 + 6.5 * d)}:${round(1 + 5 * d)}:${round(2 + 10 * d)}:${round(1.5 + 7.5 * d)}` : null,
    finish,
  };
}

/** Position shown in the panel: pixels from the centre of the frame, upwards positive (as in CapCut). */
export const positionPx = (p: Picture) => ({ x: Math.round((p.x - 0.5) * OUTPUT_WIDTH), y: Math.round((0.5 - p.y) * OUTPUT_HEIGHT) });
export const positionFromPx = (px: { x?: number; y?: number }): PictureSettings => ({
  ...(px.x !== undefined && { x: 0.5 + px.x / OUTPUT_WIDTH }),
  ...(px.y !== undefined && { y: 0.5 - px.y / OUTPUT_HEIGHT }),
});
