/**
 * Voice / music separation with an MDX-Net model (Ultimate Vocal Remover's
 * "Kim_Vocal_2", run locally with onnxruntime). The voice is predicted by the
 * model and the music is the original minus the voice. Results are stored as
 * lossless FLAC next to the clip so exports stay sample-accurate.
 */
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { config } from './config';
import { ffmpeg, run } from './ffmpeg';
import { errorMessage, jobs, type JobContext } from './jobs';
import { getMedia, mediaPaths, updateMedia } from './media-store';
import { computeEnvelope } from './envelope';
import { download } from './download';

const MODEL_FILE = 'Kim_Vocal_2.onnx';
const MODEL_URL = () =>
  process.env.SEPARATION_MODEL_URL || `https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/${MODEL_FILE}`;
const MAX_SECONDS = 20 * 60;

const modelPath = () => path.join(config.storageDir, 'separation', MODEL_FILE);
const workerPath = () => path.join(/*turbopackIgnore: true*/ process.cwd(), 'worker', 'separate.mjs');
const threads = () => Math.max(2, Math.min(8, os.availableParallelism() - 1));

async function ensureModel(ctx: JobContext) {
  const file = modelPath();
  const st = await stat(file).catch(() => null);
  if (st && st.size > 10_000_000) return file;
  await download(
    MODEL_URL(),
    file,
    (r, t) =>
      ctx.progress(t ? (r / t) * 0.1 : 0, `Descargando el modelo de separación (una sola vez)… ${Math.round(r / 1e6)} de ${Math.round(t / 1e6)} MB`),
    ctx.signal,
  );
  return file;
}

async function separate(id: string, ctx: JobContext) {
  const rec = await getMedia(id);
  if (!rec) throw new Error('Medio no encontrado');
  if (!rec.hasAudio) throw new Error('Este clip no tiene audio');
  if (rec.duration > MAX_SECONDS) throw new Error('El clip es demasiado largo para separarlo (máximo 20 minutos)');
  const paths = mediaPaths(id);
  const tmp = path.join(config.storageDir, 'tmp', `separate-${ctx.id}`);
  await mkdir(tmp, { recursive: true });
  const report = (p: number, message: string) => {
    ctx.progress(p, message);
    void updateMedia(id, { separation: { status: 'running', progress: p, message, error: null } });
  };
  try {
    await updateMedia(id, { separation: { status: 'running', progress: 0, message: 'Preparando…', error: null } });
    const model = await ensureModel(ctx);
    report(0.1, 'Leyendo el audio…');
    const mix = path.join(tmp, 'mix.f32');
    await ffmpeg(['-y', '-loglevel', 'error', '-i', rec.sourcePath, '-vn', '-ac', '2', '-ar', '44100', '-f', 'f32le', mix], { signal: ctx.signal });

    report(0.12, 'Separando la voz de la música…');
    const voiceRaw = path.join(tmp, 'voice.f32');
    const musicRaw = path.join(tmp, 'music.f32');
    let last = 0;
    const res = await run(process.execPath, [workerPath(), model, mix, voiceRaw, musicRaw, String(threads())], {
      signal: ctx.signal,
      onStdoutLine: (line) => {
        const m = /^progress ([\d.]+)/.exec(line);
        const p = m ? Number(m[1]) : NaN;
        if (Number.isFinite(p) && (p - last >= 0.02 || p >= 1)) {
          last = p;
          report(0.12 + p * 0.8, 'Separando la voz de la música…');
        }
      },
    });
    if (res.code !== 0) throw new Error(`La separación falló:\n${res.stderr.trim().split(/\r?\n/).slice(-4).join('\n')}`);

    report(0.93, 'Guardando las pistas…');
    for (const [raw, out] of [
      [voiceRaw, paths.voice],
      [musicRaw, paths.music],
    ]) {
      await ffmpeg(['-y', '-loglevel', 'error', '-f', 'f32le', '-ar', '44100', '-ac', '2', '-i', raw, '-c:a', 'flac', out], { signal: ctx.signal });
    }
    await writeFile(paths.voiceEnvelope, await computeEnvelope(paths.voice, ctx.signal));
    await updateMedia(id, { separation: { status: 'done', progress: 1, message: null, error: null } });
  } catch (err) {
    const aborted = ctx.signal.aborted;
    await updateMedia(id, {
      separation: { status: aborted ? 'none' : 'error', progress: 0, message: null, error: aborted ? null : errorMessage(err) },
    });
    throw err;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export async function enqueueSeparation(id: string) {
  const existing = jobs.active('separate', id);
  if (existing) return existing;
  await updateMedia(id, { separation: { status: 'queued', progress: 0, message: 'En cola…', error: null } });
  return jobs.enqueue('separate', id, (ctx) => separate(id, ctx));
}

export const hasStems = (id: string) => existsSync(mediaPaths(id).voice) && existsSync(mediaPaths(id).music);

/** Video of the clip with the chosen voice/music mix, for the preview player. */
export async function mixPreview(id: string, voice: number, music: number): Promise<{ file: string } | { jobId: string }> {
  const paths = mediaPaths(id);
  const file = paths.mix(voice, music);
  if (existsSync(file)) return { file };
  const active = jobs.active('mix', `${id}:${path.basename(file)}`);
  if (active) return { jobId: active.id };
  const rec = await getMedia(id);
  if (!rec || !hasStems(id)) throw new Error('Primero separa la voz y la música de este clip');
  const job = jobs.enqueue('mix', `${id}:${path.basename(file)}`, async (ctx) => {
    const video = rec.hasProxy && existsSync(paths.proxy) ? paths.proxy : rec.sourcePath;
    const part = `${file}.part.mp4`;
    // prettier-ignore
    await ffmpeg([
      '-y', '-loglevel', 'error', '-i', video, '-i', paths.voice, '-i', paths.music,
      '-filter_complex', `[1:a]volume=${voice}[v];[2:a]volume=${music}[m];[v][m]amix=inputs=2:normalize=0:duration=first[a]`,
      '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', part,
    ], { signal: ctx.signal });
    await rename(part, file);
    // Keep only the three most recent mixes of this clip.
    const dir = path.dirname(file);
    const mixes = (await readdir(dir)).filter((f) => /^mix-v\d+-m\d+\.mp4$/.test(f));
    if (mixes.length > 3) {
      const withTime = await Promise.all(mixes.map(async (f) => ({ f, t: (await stat(path.join(dir, f))).mtimeMs })));
      withTime.sort((a, b) => b.t - a.t);
      for (const { f } of withTime.slice(3)) await rm(path.join(dir, f), { force: true });
    }
    return { file };
  });
  return { jobId: job.id };
}
