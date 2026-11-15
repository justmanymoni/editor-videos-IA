/**
 * Places the letters of a text along an arc (up to a full circle) or a sine
 * wave. Pure geometry: the caller supplies each letter's width.
 */
export interface GlyphPosition {
  /** Centre of the letter, relative to the centre of the whole text. */
  x: number;
  y: number;
  /** Rotation in radians, clockwise. */
  rot: number;
}

export function layoutCurve(advances: number[], curve: 'arc' | 'wave', amount: number, fontSize: number): GlyphPosition[] {
  const total = advances.reduce((s, a) => s + a, 0);
  if (!advances.length || total <= 0) return [];
  const out: GlyphPosition[] = [];
  let cursor = 0;
  if (curve === 'arc') {
    // `amount` % of a full circle; the sign chooses bending up (∩) or down (∪).
    const fraction = Math.min(1, Math.max(0.02, Math.abs(amount) / 100));
    const radius = total / (2 * Math.PI * fraction);
    const up = amount >= 0;
    for (const a of advances) {
      const phi = (cursor + a / 2 - total / 2) / radius;
      cursor += a;
      out.push({ x: radius * Math.sin(phi), y: (up ? 1 : -1) * radius * (1 - Math.cos(phi)), rot: up ? phi : -phi });
    }
  } else {
    // One full sine period across the text.
    const amp = (Math.max(-100, Math.min(100, amount)) / 100) * fontSize * 0.9;
    const k = (2 * Math.PI) / total;
    for (const a of advances) {
      const s = cursor + a / 2;
      cursor += a;
      out.push({ x: s - total / 2, y: amp * Math.sin(k * s), rot: Math.atan(amp * k * Math.cos(k * s)) });
    }
  }
  // Centre the shape on its bounding box so it rotates and scales around its middle.
  const xs = out.map((g) => g.x);
  const ys = out.map((g) => g.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return out.map((g) => ({ x: g.x - cx, y: g.y - cy, rot: g.rot }));
}

/** Size of an overlay that covers the 1080x1920 frame while keeping the media's aspect ratio. */
export function overlayRect(mediaWidth: number, mediaHeight: number, frameW: number, frameH: number, x = 0.5, y = 0.5, scale = 1) {
  const ar = mediaWidth > 0 && mediaHeight > 0 ? mediaWidth / mediaHeight : frameW / frameH;
  const baseW = Math.max(frameW, frameH * ar);
  const width = baseW * scale;
  const height = (baseW / ar) * scale;
  return { width, height, left: x * frameW - width / 2, top: y * frameH - height / 2 };
}
