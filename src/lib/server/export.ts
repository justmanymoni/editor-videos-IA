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
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { ProjectDoc, Word } from '../shared/types';
import { OUTPUT_FPS, OUTPUT_HEIGHT, OUTPUT_WIDTH } from '../shared/types';
import { FRAME, clamp } from '../shared/ranges';
import { buildClipWords, buildSegments, sequenceDuration, type Segment } from '../shared/timeline';
import { buildPages, collectSubWords } from '../shared/subtitles';
import { buildAss } from '../shared/ass';
import { getFont } from '../shared/fonts';
import { overlayRect } from '../shared/text-curve';
import {
  STABILIZE_LEVELS,
  blendMode,
  hasImprovements,
  improveFilters,
  isPlainPicture,
  pictureOf,
  pictureRect,
  placePicture,
  type Picture,
  type Placement,
} from '../shared/picture';
import { textMotion } from '../shared/text-anim';
import { OVERLAY_LANES, TEXT_LANES, byLayer } from '../shared/lanes';
import { config } from './config';
import { ffmpegHasFilter, ffmpegMajor, ffmpegWithProgress } from './ffmpeg';
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

/** A first pass over a clip that measures how the camera shakes (the render then compensates it). */
export interface StabilizePass {
  /** Input options and file. */
  input: string[];
  /** Filter chain that writes `file` (relative to the work folder). */
  filter: string;
  file: string;
  /** Seconds of video it reads. */
  duration: number;
}

export interface ExportPlan {
  inputs: string[][];
  filter: string;
  duration: number;
  ass: string | null;
  fontFile: string | null;
  /** Passes to run, in the work folder, before the render. */
  stabilize: StabilizePass[];
}

export interface PlanOptions {
  /** FFmpeg has the two-pass stabiliser (vidstab); without it the simpler `deshake` filter is used. */
  vidstab?: boolean;
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

/** `atempo` changes the speed keeping the pitch; one instance only goes down to half speed, so slower ones are chained. */
export function atempo(speed: number): string {
  const parts: string[] = [];
  let rest = speed;
  while (rest < 0.5) {
    parts.push('atempo=0.5');
    rest /= 0.5;
  }
  parts.push(`atempo=${num(rest)}`);
  return parts.join(',');
}

const BLUR_BG = `scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=10:2,scale=${W}:${H},lutyuv=y=val*0.8`;

/**
 * Filters that draw the visible part of a picture at its size, improved,
 * turned and with its opacity, and where its centre goes when overlaid.
 */
function pictureChain(pic: Picture, place: Placement): { chain: string[]; x: string; y: string } {
  const chain: string[] = [];
  const { crop } = place;
  if (!place.whole) chain.push(`crop=w='iw*${num(crop.w)}':h='ih*${num(crop.h)}':x='iw*${num(crop.x)}':y='ih*${num(crop.y)}'`);
  chain.push(`scale=${even(place.width)}:${even(place.height)}${pic.upscale ? ':flags=lanczos' : ''}`, 'setsar=1', ...improveFilters(pic).finish);
  if (pic.rotation) {
    const a = num((pic.rotation * Math.PI) / 180);
    chain.push('format=rgba', `rotate=${a}:ow='rotw(${a})':oh='roth(${a})':c=black@0`);
  }
  if (pic.opacity < 1) chain.push('format=rgba', `colorchannelmixer=aa=${num(pic.opacity)}`);
  return { chain, x: `'${num(place.cx)}-w/2'`, y: `'${num(place.cy)}-h/2'` };
}

/** Puts a clip of the main track on the 1080x1920 frame: covering it, or over its own blurred copy. */
function fitChain(input: string, output: string, mode: ProjectDoc['settings']['fitMode'], k: number, pic: Picture, m: PlanMedia): string[] {
  const blur = mode === 'blur';
  const { finish } = improveFilters(pic);
  const flags = pic.upscale ? ':flags=lanczos' : '';
  const extra = finish.length ? `,${finish.join(',')}` : '';
  if (isPlainPicture(pic)) {
    if (!blur) {
      return [`[${input}]scale=${W}:${H}:force_original_aspect_ratio=increase${flags},crop=${W}:${H}${extra},setsar=1,format=yuv420p[${output}]`];
    }
    return [
      `[${input}]split=2[bg${k}][fg${k}]`,
      `[bg${k}]${BLUR_BG}[bgb${k}]`,
      `[fg${k}]scale=${W}:${H}:force_original_aspect_ratio=decrease${flags}${extra}[fgs${k}]`,
      `[bgb${k}][fgs${k}]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[${output}]`,
    ];
  }
  // Moved, resized, turned or see-through: its visible part is drawn over black (or over the blurred copy).
  const place = placePicture(pictureRect(m.width ?? 0, m.height ?? 0, pic, blur), pic.rotation);
  // The background has the frames of the clip itself, so both always have the same length.
  const base = blur ? BLUR_BG : `scale=${W}:${H}:flags=neighbor,drawbox=c=black:t=fill`;
  if (!place || pic.opacity <= 0) return [`[${input}]${base},setsar=1,format=yuv420p[${output}]`];
  const { chain, x, y } = pictureChain(pic, place);
  return [
    `[${input}]split=2[bg${k}][fg${k}]`,
    `[bg${k}]${base},setsar=1,format=yuv420p[bgb${k}]`,
    `[fg${k}]${chain.join(',')}[fgs${k}]`,
    `[bgb${k}][fgs${k}]overlay=x=${x}:y=${y},setsar=1,format=yuv420p[${output}]`,
  ];
}

export function buildExportPlan(
  doc: ProjectDoc,
  media: Map<string, PlanMedia>,
  transcripts: Record<string, Word[] | undefined>,
  textImages: TextImage[] = [],
  options: PlanOptions = {},
): ExportPlan {
  const segs = buildSegments(doc.clips);
  const total = sequenceDuration(segs);
  if (total < FRAME) throw new Error('La línea de tiempo está vacía: añade un clip antes de exportar.');

  const inputs: string[][] = [];
  const filters: string[] = [];
  const stabilize: StabilizePass[] = [];
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
    const still = m.kind === 'image';
    // A photo on the main track is a looped still: any part of it looks the same.
    const input = still
      ? ['-loop', '1', '-framerate', String(FPS), '-t', num(span + 0.5), '-i', m.sourcePath]
      : ['-ss', num(s0), '-t', num(span + 0.5), '-i', m.sourcePath];
    inputs.push(input);
    const pic = pictureOf(doc.clips[run[0].clipIndex]);
    // The frames of the clip, one every 1/30 s from its start.
    const head = `settb=AVTB,setpts=PTS-STARTPTS,fps=${FPS}`;
    // Stabilisation works on the frames as they were shot, before any cut.
    let steady = '';
    if (pic.stabilize && !still) {
      const level = STABILIZE_LEVELS[pic.stabilize - 1];
      if (options.vidstab) {
        const file = `stab-${k}.trf`;
        stabilize.push({ input, filter: `${head},vidstabdetect=shakiness=8:accuracy=15:result=${file}`, file, duration: span + 0.5 });
        steady = `,vidstabtransform=input=${file}:smoothing=${level.smoothing}:optzoom=1:interpol=bicubic`;
      } else steady = `,deshake=rx=${level.shake}:ry=${level.shake}:edge=mirror`;
    }
    const denoise = !still && improveFilters(pic).denoise;
    // A clip at another speed: retime the kept frames and force the exact number of frames it takes on the timeline.
    const speed = still ? 1 : run[0].speed;
    const frames = Math.round((run[run.length - 1].tlEnd - run[0].tlStart) * FPS);
    // Slow motion repeats frames; with "flujo óptico" the ones in between are worked out (on a picture no larger than needed).
    const big = Math.max(m.width ?? 0, m.height ?? 0);
    const shrink = big > H ? `scale=${even(((m.width ?? 0) * H) / big)}:${even(((m.height ?? 0) * H) / big)},` : '';
    const retimeFps =
      pic.opticalFlow && speed < 1 ? `${shrink}minterpolate=fps=${FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1` : `fps=${FPS}`;
    const retimeV =
      speed === 1 ? '' : `,setpts=PTS/${num(speed)},${retimeFps},tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${frames},setpts=N/${FPS}/TB`;
    const retimeA = speed === 1 ? '' : `,${atempo(speed)},apad=pad_dur=1,atrim=end_sample=${frames * 1600},asetpts=N/SR/TB`;
    filters.push(`[${vin}:v:0]${head}${steady},select='${expr}',setpts=N/${FPS}/TB${denoise ? `,${denoise}` : ''}${retimeV}[vr${k}]`);
    filters.push(...fitChain(`vr${k}`, `v${k}`, doc.settings.fitMode, k, pic, m));
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
      `[${audio}]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetnsamples=n=1600:p=1,aselect='${expr}',asetpts=N/SR/TB${retimeA}[a${k}]`,
    );
  });
  filters.push(`${runs.map((_, k) => `[v${k}][a${k}]`).join('')}concat=n=${runs.length}:v=1:a=1[vcat][acat]`);

  // B-roll overlays.
  let video = 'vcat';
  // Lowest layer first: overlays on upper rows of the timeline cover the ones below.
  byLayer(doc.broll, OVERLAY_LANES).forEach((b, j) => {
    const m = need(b.mediaId);
    const start = clamp(b.start, 0, total);
    const end = Math.min(total, b.start + b.duration);
    if (end - start < FRAME) return;
    const dur = end - start;
    const idx = inputs.length;
    if (m.kind === 'image') inputs.push(['-loop', '1', '-framerate', String(FPS), '-t', num(dur + 0.2), '-i', m.sourcePath]);
    else inputs.push(['-ss', num(Math.max(0, b.srcIn)), '-t', num(dur + 0.2), '-i', m.sourcePath]);
    const pic = pictureOf(b);
    const shown = `eof_action=pass:enable='between(t,${num(start)},${num(end - 0.001)})'`;
    const timed = `trim=duration=${num(dur)},setpts=PTS+${num(start)}/TB`;
    if (pic.rotation === 0 && pic.uniform && pic.opacity === 1 && pic.blend === 'normal' && !hasImprovements(pic)) {
      // Full-frame b-roll is cropped to cover; a moved or resized overlay keeps its shape (sticker, picture-in-picture).
      const rect = overlayRect(m.width ?? 0, m.height ?? 0, W, H, pic.x, pic.y, pic.scale);
      const full = pic.scale === 1 && pic.x === 0.5 && pic.y === 0.5;
      const size = full ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}` : `scale=${even(rect.width)}:${even(rect.height)}`;
      const at = full ? '0:0' : `${Math.round(rect.left)}:${Math.round(rect.top)}`;
      filters.push(`[${idx}:v:0]settb=AVTB,setpts=PTS-STARTPTS,fps=${FPS},${size},setsar=1,format=yuva420p,${timed}[b${j}]`);
      filters.push(`[${video}][b${j}]overlay=${at}:${shown}[vb${j}]`);
      video = `vb${j}`;
      return;
    }
    // Turned, stretched, see-through, blended or improved: only its visible part is drawn.
    const place = placePicture(pictureRect(m.width ?? 0, m.height ?? 0, pic), pic.rotation);
    if (!place || pic.opacity <= 0) return;
    const { chain, x, y } = pictureChain(pic, place);
    const denoise = m.kind === 'video' && improveFilters(pic).denoise;
    filters.push(
      `[${idx}:v:0]settb=AVTB,setpts=PTS-STARTPTS,fps=${FPS}${denoise ? `,${denoise}` : ''},${chain.join(',')},format=rgba,${timed}[b${j}]`,
    );
    if (pic.blend === 'normal') {
      filters.push(`[${video}][b${j}]overlay=x=${x}:y=${y}:${shown}[vb${j}]`);
    } else {
      // The overlay alone on a see-through frame, mixed with the video in RGB and put back only where the overlay is.
      filters.push(
        `[${video}]split=3[obv${j}][obw${j}][obz${j}]`,
        `[obz${j}]format=rgba,colorchannelmixer=aa=0[obc${j}]`,
        `[obc${j}][b${j}]overlay=x=${x}:y=${y}:format=rgb:${shown},split=2[obl${j}][obm${j}]`,
        `[obm${j}]alphaextract[oba${j}]`,
        `[obw${j}]format=gbrp[obg${j}]`,
        `[obl${j}]format=gbrp[obf${j}]`,
        `[obg${j}][obf${j}]blend=all_mode=${blendMode(pic.blend).ffmpeg}[obb${j}]`,
        `[obb${j}][oba${j}]alphamerge[obx${j}]`,
        `[obv${j}][obx${j}]overlay=format=auto[vb${j}]`,
      );
    }
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
  byLayer(doc.texts, TEXT_LANES).forEach((t, j) => {
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

  return { inputs, filter: filters.join(';\n'), duration: total, ass, fontFile, stabilize };
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
  const plan = buildExportPlan(doc, media, transcripts, textImages, { vidstab: await ffmpegHasFilter('vidstabtransform') });
  // Measuring the shake of the clips to stabilise takes a part of the bar; the render, the rest.
  const first = plan.stabilize.length ? 0.3 : 0;
  await renderPlan(
    plan,
    out,
    work,
    quality,
    (p, stage = 'Renderizando') => ctx.progress(0.01 + (stage === 'Renderizando' ? first + p * (0.98 - first) : p * first), stage),
    ctx.signal,
  );
  const size = (await stat(out)).size;
  return { name, url: `/api/exports/${encodeURIComponent(name)}`, duration: plan.duration, size };
}

/** Name of the video inside the scratch directory while it is being rendered. */
const RENDERING = 'render.mp4';

/**
 * Runs FFmpeg for a plan. `work` is a scratch directory (subtitle file, fonts
 * and filter graph); it is removed on success and kept on failure for debugging.
 */
export async function renderPlan(
  plan: ExportPlan,
  out: string,
  work: string,
  quality: ExportQuality,
  onProgress: (p: number, stage?: string) => void,
  signal?: AbortSignal,
) {
  await mkdir(work, { recursive: true });
  await mkdir(path.dirname(out), { recursive: true });
  // First pass of the stabilisation: how the camera moves in each clip, written to a file the render reads.
  const reading = plan.stabilize.reduce((n, pass) => n + pass.duration, 0);
  let read = 0;
  for (const [i, pass] of plan.stabilize.entries()) {
    const stage = plan.stabilize.length > 1 ? `Estabilizando (${i + 1} de ${plan.stabilize.length})` : 'Estabilizando';
    // prettier-ignore
    const args = ['-y', '-loglevel', 'error', ...pass.input, '-an', '-sn', '-vf', pass.filter, '-f', 'null', '-'];
    await ffmpegWithProgress(args, pass.duration, (p) => onProgress((read + p * pass.duration) / reading, stage), { cwd: work, signal }).catch(
      async (err) => {
        if (signal?.aborted) await rm(work, { recursive: true, force: true });
        throw err;
      },
    );
    read += pass.duration;
  }
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
    RENDERING,
  ];
  await writeFile(path.join(work, 'command.json'), JSON.stringify(args, null, 1));
  // The video is rendered inside the scratch directory and only moved to its
  // final name once complete, so a half-written file never shows up as an export.
  const partial = path.join(work, RENDERING);
  try {
    await ffmpegWithProgress(args, plan.duration, onProgress, { cwd: work, signal });
    await rename(partial, out).catch(async (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EXDEV') throw err;
      await copyFile(partial, out);
    });
  } catch (err) {
    // A cancelled render leaves nothing behind; a failed one keeps its files to find out why.
    await rm(signal?.aborted ? work : partial, { recursive: true, force: true });
    throw err;
  }
  await rm(work, { recursive: true, force: true });
}

export async function listExports() {
  await mkdir(exportsDir(), { recursive: true });
  const files = (await readdir(exportsDir())).filter((f) => f.endsWith('.mp4'));
  const out = await Promise.all(
    files.map(async (name) => {
      // A file can disappear between the listing and this read (deleted by the user, for instance).
      const st = await stat(path.join(exportsDir(), name)).catch(() => null);
      return st && { name, url: `/api/exports/${encodeURIComponent(name)}`, size: st.size, createdAt: st.mtime.toISOString() };
    }),
  );
  return out.filter((e) => e !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
