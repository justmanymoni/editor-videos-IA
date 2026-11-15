/**
 * The "filmstrip" of a video: small frames taken at regular intervals and
 * packed in one image (a grid). The timeline draws them along each clip so
 * its content can be seen at a glance.
 */
export interface Filmstrip {
  /** Seconds between two frames. */
  interval: number;
  /** Number of frames. */
  count: number;
  /** Frames per row of the image. */
  cols: number;
  /** Size of one frame in the image, in pixels. */
  tileW: number;
  tileH: number;
}

const TILE_HEIGHT = 72;
const COLS = 20;
/** Most frames a filmstrip holds; longer videos get a frame less often. */
const MAX_FRAMES = 300;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** How the filmstrip of a video of that length and shape is laid out. */
export function filmstripLayout(duration: number, width: number, height: number): Filmstrip {
  const interval = Math.min(5, Math.max(0.25, Math.round((duration / MAX_FRAMES) * 100) / 100));
  const count = Math.max(1, Math.ceil(duration / interval));
  const aspect = width > 0 && height > 0 ? width / height : 9 / 16;
  return { interval, count, cols: COLS, tileW: Math.min(192, Math.max(32, even(TILE_HEIGHT * aspect))), tileH: TILE_HEIGHT };
}

export const filmstripRows = (strip: Filmstrip) => Math.ceil(strip.count / strip.cols);

/** Frame of the filmstrip that shows source time `t`. */
export const frameAt = (strip: Filmstrip, t: number) => Math.min(strip.count - 1, Math.max(0, Math.round(t / strip.interval)));
