import { config } from './config';
import { runChecked } from './ffmpeg';

/** Envelope frames per second (10 ms windows). */
export const ENVELOPE_RATE = 100;
const SAMPLE_RATE = 16000;
const WINDOW = SAMPLE_RATE / ENVELOPE_RATE;

/** Loudness per 10 ms as dBFS + 100 (0..100), decoded with FFmpeg. */
export async function computeEnvelope(file: string, signal?: AbortSignal): Promise<Uint8Array> {
  const values: number[] = [];
  let pending: Buffer = Buffer.alloc(0);
  const frameBytes = WINDOW * 2;
  const consume = (chunk: Buffer) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    let off = 0;
    while (off + frameBytes <= pending.length) {
      let sum = 0;
      for (let i = 0; i < WINDOW; i++) {
        const s = pending.readInt16LE(off + i * 2) / 32768;
        sum += s * s;
      }
      const rms = Math.sqrt(sum / WINDOW);
      const db = rms > 0 ? 20 * Math.log10(rms) : -100;
      values.push(Math.max(0, Math.min(100, Math.round(db + 100))));
      off += frameBytes;
    }
    pending = pending.subarray(off);
  };
  await runChecked(
    config.ffmpeg,
    ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1'],
    { signal, onStdoutData: consume },
  );
  return Uint8Array.from(values);
}
