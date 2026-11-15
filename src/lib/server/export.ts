/**
 * MP4 export (1080x1920, 30 fps) with FFmpeg.
 *
 * Main track: one input per clip instance (input seeking), frames and audio
 * normalised to a shared 1/30 s grid (fps=30 + 1600-sample audio frames at
 * 48 kHz) and filtered with the same select expression, so every cut is frame
 * exact and audio never drifts. B-roll is overlaid, music mixed and the
 * subtitles burned in with libass using the same fonts as the preview.
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import type { ProjectDoc, Word } from '../shared/types';
import { OUTPUT_FPS, OUTPUT_HEIGHT, OUTPUT_WIDTH } from '../shared/types';
import { FRAME, clamp } from '../shared/ranges';
import { buildClipWords, buildSegments, sequenceDuration, type Segment } from '../shared/timeline';
import { buildPages, collectSubWords } from '../shared/subtitles';
import { buildAss } from '../shared/ass';
import { getFont } from '../shared/fonts';
import { overlayRect } from '../shared/text-curve';
import { textMotion } from '../shared/text-anim';
import { config } from './config';
import { ffmpegMajor, ffmpegWithProgress } from './ffmpeg';
import type { JobContext } from './jobs';
import { getMedia, mediaPaths, readTranscript } from './media-store';

export interface PlanMedia {
  id: string;
  kind: 'video' | 'image' | 'audio';
  sourcePath: string;
  hasAudio: boolean;
  width?: number;
  height?: number;
  /** Separated voice and music (FLAC), when available. */
  stems?: { voice: string; music: string };
}

export interface ExportPlan {
  inputs: string[][];
  filter: string;
  duration: number;
  ass: string | null;
  fontFile: string | null;
}

/** A manual text rendered to a transparent PNG by the editor (file relative to the work folder). */
export interface TextImage {
  id: string;
  file: string;
  width: number;
  height: number;
}

export type ExportQuality = 'high' | 'normal' | 'fast';

const W = OUTPUT_WIDTH;
const H = OUTPUT_HEIGHT;
const FPS = OUTPUT_FPS;
const HALF = 0.5 / FPS;
const num = (x: number) => String(Math.round(x * 100000) / 100000);
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

function fitChain(input: string, output: string, mode: ProjectDoc['settings']['fitMode'], k: number): string[] {
  if (mode !== 'blur') {
    return [`[${input}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,format=yuv420p[${output}]`];
  }
  return [
    `[${input}]split=2[bg${k}][fg${k}]`,
    `[bg${k}]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=10:2,scale=${W}:${H},lutyuv=y=val*0.8[bgb${k}]`,
    `[fg${k}]scale=${W}:${H}:force_original_aspect_ratio=decrease[fgs${k}]`,
    `[bgb${k}][fgs${k}]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[${output}]`,
  ];
}

export function buildExportPlan(
  doc: ProjectDoc,
  media: Map<string, PlanMedia>,
  transcripts: Record<string, Word[] | undefined>,
  textImages: TextImage[] = [],
): ExportPlan {
  const segs = buildSegments(doc.clips);
  const total = sequenceDuration(segs);
  if (total < FRAME) throw new Error('La línea de tiempo está vacía: añade un clip antes de exportar.');

  const inputs: string[][] = [];
  const filters: string[] = [];
  const need = (id: string) => {
    const m = media.get(id);
    if (!m) throw new Error(`Falta el archivo de un medio del proyecto (${id}).`);
    return m;
  };

  // Main track, grouped by clip instance.
  const runs: Segment[][] = [];
  for (const s of segs) {
    const last = runs[runs.length - 1];
    if (last && last[0].clipIndex === s.clipIndex) last.push(s);
    else runs.push([s]);
  }
  runs.forEach((run, k) => {
    const m = need(run[0].mediaId);
    const s0 = run[0].srcStart;
    const span = run[run.length - 1].srcEnd - s0;
    const expr = run.map((s) => `gte(t,${num(s.srcStart - s0 - HALF)})*lt(t,${num(s.srcEnd - s0 - HALF)})`).join('+');
    const vin = inputs.length;
    // A photo on the main track is a looped still: any part of it looks the same.
    if (m.kind === 'image') inputs.push(['-loop', '1', '-framerate', String(FPS), '-t', num(span + 0.5), '-i', m.sourcePath]);
    else inputs.push(['-ss', num(s0), '-t', num(span + 0.5), '-i', m.sourcePath]);
    filters.push(`[${vin}:v:0]settb=AVTB,setpts=PTS-STARTPTS,fps=${FPS},select='${expr}',setpts=N/${FPS}/TB[vr${k}]`);
    filters.push(...fitChain(`vr${k}`, `v${k}`, doc.settings.fitMode, k));
    let audio = `${vin}:a:0`;
    const mix = doc.audioMix?.[m.id];
    if (m.hasAudio && mix && m.stems) {
      // Separated voice and music at the chosen volumes, instead of the original audio.
      const vi = inputs.length;
      inputs.push(['-ss', num(s0), '-t', num(span + 0.5), '-i', m.stems.voice], ['-ss', num(s0), '-t', num(span + 0.5), '-i', m.stems.music]);
      filters.push(
        `[${vi}:a:0]volume=${num(mix.voice)}[sv${k}];[${vi + 1}:a:0]volume=${num(mix.music)}[sm${k}];[sv${k}][sm${k}]amix=inputs=2:normalize=0[mx${k}]`,
      );
      audio = `mx${k}`;
    } else if (!m.hasAudio) {
      audio = `${inputs.length}:a:0`;
      inputs.push(['-f', 'lavfi', '-t', num(span + 0.5), '-i', 'anullsrc=r=48000:cl=stereo']);
    }
    filters.push(
      `[${audio}]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetnsamples=n=1600:p=1,aselect='${expr}',asetpts=N/SR/TB[a${k}]`,
    );
  });
  filters.push(`${runs.map((_, k) => `[v${k}][a${k}]`).join('')}concat=n=${runs.length}:v=1:a=1[vcat][acat]`);

  // B-roll overlays.
  let video = 'vcat';
  [...doc.broll]
    .sort((a, b) => a.start - b.start)
    .forEach((b, j) => {
      const m = need(b.mediaId);
      const start = clamp(b.start, 0, total);
      const end = Math.min(total, b.start + b.duration);
      if (end - start < FRAME) return;
      const dur = end - start;
      const idx = inputs.length;
      if (m.kind === 'image') inputs.push(['-loop', '1', '-framerate', String(FPS), '-t', num(dur + 0.2), '-i', m.sourcePath]);
      else inputs.push(['-ss', num(Math.max(0, b.srcIn)), '-t', num(dur + 0.2), '-i', m.sourcePath]);
      // Full-frame b-roll is cropped to cover; a moved or resized overlay keeps its shape (sticker, picture-in-picture).
      const rect = overlayRect(m.width ?? 0, m.height ?? 0, W, H, b.x ?? 0.5, b.y ?? 0.5, b.scale ?? 1);
      const full = (b.scale ?? 1) === 1 && (b.x ?? 0.5) === 0.5 && (b.y ?? 0.5) === 0.5;
      const size = full ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}` : `scale=${even(rect.width)}:${even(rect.height)}`;
      const at = full ? '0:0' : `${Math.round(rect.left)}:${Math.round(rect.top)}`;
      filters.push(
        `[${idx}:v:0]settb=AVTB,setpts=PTS-STARTPTS,fps=${FPS},${size},setsar=1,format=yuva420p,trim=duration=${num(dur)},setpts=PTS+${num(start)}/TB[b${j}]`,
      );
      filters.push(`[${video}][b${j}]overlay=${at}:eof_action=pass:enable='between(t,${num(start)},${num(end - 0.001)})'[vb${j}]`);
      video = `vb${j}`;
    });

  // Subtitles.
  let ass: string | null = null;
  let fontFile: string | null = null;
  if (doc.subtitles.enabled) {
    const pages = buildPages(collectSubWords(buildClipWords(doc, transcripts, segs), doc.subtitles), doc.subtitles);
    if (pages.length) {
      ass = buildAss(pages, doc.subtitles);
      fontFile = getFont(doc.subtitles.fontId).file;
      filters.push(`[${video}]subtitles=filename=subs.ass:fontsdir=fonts[vsub]`);
      video = 'vsub';
    }
  }
  // Manual texts (pre-rendered PNGs), on top of everything.
  doc.texts.forEach((t, j) => {
    const img = textImages.find((x) => x.id === t.id);
    const start = clamp(t.start, 0, total);
    const end = Math.min(total, t.start + t.duration);
    if (!img || end - start < FRAME) return;
    const idx = inputs.length;
    inputs.push(['-loop', '1', '-framerate', String(FPS), '-t', num(end - start + 0.2), '-i', img.file]);
    // Entrance and exit: the same motion as the preview, as expressions of the output time.
    const motion = textMotion(t, t.start, t.start + t.duration);
    const chain = ['format=rgba', `setpts=PTS-STARTPTS+${num(start)}/TB`];
    if (motion.fadeIn) chain.push(`fade=${motion.fadeIn}`);
    if (motion.fadeOut) chain.push(`fade=${motion.fadeOut}`);
    if (motion.scale) chain.push(`scale=w='max(2,iw*${motion.scale})':h='max(2,ih*${motion.scale})':eval=frame`);
    filters.push(`[${idx}:v:0]${chain.join(',')}[t${j}]`);
    // `w` and `h` are the size of the text image on each frame, so it stays centred while it grows.
    const moving = motion.scale || motion.dx || motion.dy;
    const x = moving ? `'${num(t.x * W)}-w/2${motion.dx ? `+${motion.dx}` : ''}'` : String(Math.round(t.x * W - img.width / 2));
    const y = moving ? `'${num(t.y * H)}-h/2${motion.dy ? `+${motion.dy}` : ''}'` : String(Math.round(t.y * H - img.height / 2));
    filters.push(`[${video}][t${j}]overlay=x=${x}:y=${y}:eof_action=pass:enable='between(t,${num(start)},${num(end - 0.001)})'[vt${j}]`);
    video = `vt${j}`;
  });
  filters.push(`[${video}]format=yuv420p[vout]`);

  // Audio: main track + music.
  filters.push(`[acat]volume=${num(doc.settings.mainVolume ?? 1)}[amain]`);
  const music: string[] = [];
  doc.audio.forEach((a, j) => {
    const m = need(a.mediaId);
    if (!m.hasAudio) return;
    const start = clamp(a.start, 0, total);
    const dur = Math.min(total, a.start + a.duration) - start;
    if (dur < FRAME) return;
    const idx = inputs.length;
    inputs.push(['-ss', num(Math.max(0, a.srcIn)), '-t', num(dur), '-i', m.sourcePath]);
    const chain = ['asetpts=PTS-STARTPTS', 'aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo', `volume=${num(a.volume)}`];
    if (a.fadeIn > 0) chain.push(`afade=t=in:st=0:d=${num(Math.min(a.fadeIn, dur))}`);
    if (a.fadeOut > 0) chain.push(`afade=t=out:st=${num(Math.max(0, dur - a.fadeOut))}:d=${num(Math.min(a.fadeOut, dur))}`);
    const ms = Math.round(start * 1000);
    if (ms > 0) chain.push(`adelay=${ms}|${ms}`);
    filters.push(`[${idx}:a:0]${chain.join(',')}[m${j}]`);
    music.push(`[m${j}]`);
  });
  if (music.length) filters.push(`[amain]${music.join('')}amix=inputs=${music.length + 1}:duration=first:dropout_transition=0:normalize=0[aout]`);
  else filters.push('[amain]anull[aout]');

  return { inputs, filter: filters.join(';\n'), duration: total, ass, fontFile };
}

const QUALITY: Record<ExportQuality, string[]> = {
  high: ['-preset', 'slow', '-crf', '18'],
  normal: ['-preset', 'medium', '-crf', '21'],
  fast: ['-preset', 'veryfast', '-crf', '23'],
};

export const exportsDir = () => path.join(config.storageDir, 'exports');

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 40) || 'video';

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/** PNG of a manual text as sent by the editor. */
export interface TextPng {
  id: string;
  png: Buffer;
  width: number;
  height: number;
}

export async function runExport(doc: ProjectDoc, quality: ExportQuality, ctx: JobContext, texts: TextPng[] = []) {
  ctx.progress(0, 'Preparando');
  const ids = new Set([...doc.clips.map((c) => c.mediaId), ...doc.broll.map((b) => b.mediaId), ...doc.audio.map((a) => a.mediaId)]);
  const media = new Map<string, PlanMedia>();
  const transcripts: Record<string, Word[] | undefined> = {};
  for (const id of ids) {
    const rec = await getMedia(id);
    if (!rec) continue;
    try {
      await stat(rec.sourcePath);
    } catch {
      throw new Error(`No se encuentra el archivo original de "${rec.name}".`);
    }
    const paths = mediaPaths(id);
    const stems =
      rec.separation?.status === 'done' && existsSync(paths.voice) && existsSync(paths.music)
        ? { voice: paths.voice, music: paths.music }
        : undefined;
    media.set(id, { id, kind: rec.kind, sourcePath: rec.sourcePath, hasAudio: rec.hasAudio, width: rec.width, height: rec.height, stems });
    if (rec.role === 'clip') transcripts[id] = (await readTranscript(id))?.words;
  }

  const name = `${slug(doc.name)}-${stamp()}.mp4`;
  const out = path.join(exportsDir(), name);
  const work = path.join(exportsDir(), `.work-${ctx.id}`);
  await mkdir(work, { recursive: true });
  const textImages: TextImage[] = [];
  for (const [i, t] of texts.entries()) {
    const file = `text-${i}.png`;
    await writeFile(path.join(work, file), t.png);
    textImages.push({ id: t.id, file, width: t.width, height: t.height });
  }
  const plan = buildExportPlan(doc, media, transcripts, textImages);
  await renderPlan(plan, out, work, quality, (p) => ctx.progress(0.01 + p * 0.98, 'Renderizando'), ctx.signal);
  const size = (await stat(out)).size;
  return { name, url: `/api/exports/${encodeURIComponent(name)}`, duration: plan.duration, size };
}

/**
 * Runs FFmpeg for a plan. `work` is a scratch directory (subtitle file, fonts
 * and filter graph); it is removed on success and kept on failure for debugging.
 */
export async function renderPlan(
  plan: ExportPlan,
  out: string,
  work: string,
  quality: ExportQuality,
  onProgress: (p: number) => void,
  signal?: AbortSignal,
) {
  await mkdir(work, { recursive: true });
  await mkdir(path.dirname(out), { recursive: true });
  if (plan.ass && plan.fontFile) {
    await writeFile(path.join(work, 'subs.ass'), plan.ass);
    await mkdir(path.join(work, 'fonts'), { recursive: true });
    await copyFile(path.join(config.fontsDir, plan.fontFile), path.join(work, 'fonts', plan.fontFile));
  }
  await writeFile(path.join(work, 'filter.txt'), plan.filter);
  const filterArgs = (await ffmpegMajor()) >= 7 ? ['-/filter_complex', 'filter.txt'] : ['-filter_complex_script', 'filter.txt'];
  // prettier-ignore
  const args = [
    '-y', '-loglevel', 'error',
    ...plan.inputs.flat(),
    ...filterArgs,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', ...QUALITY[quality], '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart', '-t', num(plan.duration),
    out,
  ];
  await writeFile(path.join(work, 'command.json'), JSON.stringify(args, null, 1));
  try {
    await ffmpegWithProgress(args, plan.duration, onProgress, { cwd: work, signal });
  } catch (err) {
    await rm(out, { force: true });
    throw err;
  }
  await rm(work, { recursive: true, force: true });
}

export async function listExports() {
  await mkdir(exportsDir(), { recursive: true });
  const files = (await readdir(exportsDir())).filter((f) => f.endsWith('.mp4'));
  const out = await Promise.all(
    files.map(async (name) => {
      const st = await stat(path.join(exportsDir(), name));
      return { name, url: `/api/exports/${encodeURIComponent(name)}`, size: st.size, createdAt: st.mtime.toISOString() };
    }),
  );
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
