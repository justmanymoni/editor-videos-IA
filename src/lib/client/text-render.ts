'use client';
/**
 * Draws manual texts on a canvas. The preview shows these canvases and the
 * export sends the very same drawing as PNG, so curved, rotated or scaled
 * text looks identical in both.
 */
import type { TextItem } from '@/lib/shared/types';
import { cssFamily, getFont } from '@/lib/shared/fonts';
import { layoutCurve } from '@/lib/shared/text-curve';

const LINE_HEIGHT = 1.18;

interface Glyph {
  text: string;
  x: number;
  y: number;
  rot: number;
}

const fontOf = (item: TextItem) => `${item.fontSize}px "${cssFamily(getFont(item.fontId))}"`;

/**
 * Renders `item` into `canvas` (which is resized). The returned size is in
 * frame pixels (1080x1920 space); the text's anchor is the canvas centre.
 */
export function renderText(canvas: HTMLCanvasElement, item: TextItem, pixelRatio = 1): { width: number; height: number } {
  const ctx = canvas.getContext('2d')!;
  ctx.font = fontOf(item);
  const size = item.fontSize;
  let glyphs: Glyph[];
  let halfW: number;
  let halfH: number;
  if (item.curve === 'none') {
    const lines = item.text.split('\n');
    glyphs = lines.map((text, i) => ({ text, x: 0, y: (i - (lines.length - 1) / 2) * size * LINE_HEIGHT, rot: 0 }));
    halfW = Math.max(size / 2, ...lines.map((l) => ctx.measureText(l).width / 2));
    halfH = (lines.length * size * LINE_HEIGHT) / 2;
  } else {
    const chars = [...item.text.replace(/\s*\n\s*/g, ' ')];
    const positions = layoutCurve(
      chars.map((c) => ctx.measureText(c).width),
      item.curve,
      item.curveAmount,
      size,
    );
    glyphs = chars.map((text, i) => ({ text, ...positions[i] }));
    const reach = size * 0.75;
    halfW = Math.max(reach, ...positions.map((p) => Math.abs(p.x) + reach));
    halfH = Math.max(reach, ...positions.map((p) => Math.abs(p.y) + reach));
  }
  const pad = item.outlineWidth + item.shadow + 4;
  halfW += pad;
  halfH += pad;
  const rot = (item.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rot));
  const sin = Math.abs(Math.sin(rot));
  const width = Math.max(2, Math.ceil(2 * (halfW * cos + halfH * sin) * item.scale));
  const height = Math.max(2, Math.ceil(2 * (halfW * sin + halfH * cos) * item.scale));
  canvas.width = Math.ceil(width * pixelRatio);
  canvas.height = Math.ceil(height * pixelRatio);

  const draw = (c: CanvasRenderingContext2D, fill: string, stroke: string) => {
    c.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    c.translate(width / 2, height / 2);
    c.rotate(rot);
    c.scale(item.scale, item.scale);
    c.font = fontOf(item);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    for (const g of glyphs) {
      c.save();
      c.translate(g.x, g.y);
      c.rotate(g.rot);
      if (item.outlineWidth > 0) {
        c.lineWidth = item.outlineWidth * 2;
        c.strokeStyle = stroke;
        c.strokeText(g.text, 0, 0);
      }
      c.fillStyle = fill;
      c.fillText(g.text, 0, 0);
      c.restore();
    }
  };

  if (item.shadow > 0) {
    // Shadow = the whole shape in black at 50 %, shifted down-right (drawn once so it stays even).
    const mask = document.createElement('canvas');
    mask.width = canvas.width;
    mask.height = canvas.height;
    draw(mask.getContext('2d')!, '#000', '#000');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.5;
    const shift = item.shadow * item.scale * pixelRatio;
    ctx.drawImage(mask, shift, shift);
    ctx.globalAlpha = 1;
  }
  draw(ctx, item.color, item.outlineColor);
  return { width, height };
}

/** Waits until the fonts used by these texts can be drawn on a canvas. */
export async function loadTextFonts(items: TextItem[]) {
  await Promise.all([...new Set(items.map(fontOf))].map((f) => document.fonts.load(f).catch(() => undefined)));
}

/** PNGs of every text at output resolution, for the export. */
export async function rasterizeTexts(items: TextItem[]) {
  await loadTextFonts(items);
  return items.map((item) => {
    const canvas = document.createElement('canvas');
    const { width, height } = renderText(canvas, item, 1);
    return { id: item.id, dataUrl: canvas.toDataURL('image/png'), width, height };
  });
}
