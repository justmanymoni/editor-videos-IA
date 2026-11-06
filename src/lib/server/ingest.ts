/**
 * Background processing of new media: thumbnail, loudness envelope (used for
 * the waveform and silence detection), browser-friendly proxy and transcription.
 */
import { writeFile } from 'node:fs/promises';
import { config, selectTranscriber } from './config';
import { ffmpeg, ffmpegWithProgress, probe } from './ffmpeg';
import { errorMessage, jobs } from './jobs';
import { extOf, getMedia, mediaPaths, updateMedia, writeTranscript, type MediaRecord } from './media-store';
import { transcribeMedia } from './transcribe';
import { ENVELOPE_RATE, computeEnvelope } from './envelope';

const PROXY_LONG_SIDE = 1280;

export function needsProxy(rec: MediaRecord, pixFmt: string | null): boolean {
  if (rec.kind !== 'video') return false;
  if (config.alwaysProxy) return true;
  const ext = extOf(rec.sourcePath);
  const okContainer = ['mp4', 'm4v', 'mov', 'webm'].includes(ext);
  const okVideo = rec.videoCodec === 'h264' || (ext === 'webm' && ['vp8', 'vp9', 'av1'].includes(rec.videoCodec ?? ''));
  const okAudio = !rec.hasAudio || ['aac', 'mp3', 'opus', 'vorbis'].includes(rec.audioCodec ?? '');
  const okPix = pixFmt === 'yuv420p' || pixFmt === 'yuvj420p';
  const tooBig = Math.max(rec.width, rec.height) > 2000;
  return !(okContainer && okVideo && okAudio && okPix) || tooBig;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Limits disk writes of progress updates to one every 500 ms. */
function throttled(fn: (p: number) => void, ms = 500) {
  let last = 0;
  return (p: number) => {
    const now = Date.now();
    if (now - last >= ms || p >= 1) {
      last = now;
      fn(p);
    }
  };
}

export function enqueueIngest(id: string) {
  const existing = jobs.active('ingest', id);
  if (existing) return existing;
  return jobs.enqueue('ingest', id, async (ctx) => {
    const rec = await getMedia(id);
    if (!rec) throw new Error('Medio no encontrado');
    const paths = mediaPaths(id);
    const stage = (name: string, progress = 0) => updateMedia(id, { status: 'processing', stage: name, progress, error: null });
    try {
      let hasThumb = false;
      let hasEnvelope = false;
      let hasProxy = false;

      if (rec.kind !== 'audio') {
        await stage('Generando miniatura');
        const seek = rec.kind === 'video' ? ['-ss', String(Math.min(1, rec.duration / 3))] : [];
        await ffmpeg(
          [
            '-y',
            '-loglevel',
            'error',
            ...seek,
            '-i',
            rec.sourcePath,
            '-frames:v',
            '1',
            '-update',
            '1',
            '-vf',
            'scale=360:-2',
            '-q:v',
            '4',
            paths.thumb,
          ],
          { signal: ctx.signal },
        );
        hasThumb = true;
        ctx.progress(0.1);
      }

      if (rec.hasAudio) {
        await stage('Analizando audio', 0.1);
        const env = await computeEnvelope(rec.sourcePath, ctx.signal);
        await writeFile(paths.envelope, env);
        hasEnvelope = true;
        ctx.progress(0.25);
      }

      const info = await probe(rec.sourcePath);
      if (needsProxy(rec, info.pixFmt)) {
        await stage('Optimizando vista previa', 0);
        const scale = Math.min(1, PROXY_LONG_SIDE / Math.max(rec.width, rec.height, 1));
        const report = throttled((p) => {
          ctx.progress(0.25 + p * 0.75);
          void updateMedia(id, { progress: p });
        });
        // prettier-ignore
        const args = [
          '-y', '-loglevel', 'error', '-i', rec.sourcePath,
          '-map', '0:v:0', '-map', '0:a:0?',
          '-vf', `scale=${even(rec.width * scale)}:${even(rec.height * scale)},format=yuv420p`,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-g', '15',
          '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
          '-movflags', '+faststart', paths.proxy,
        ];
        await ffmpegWithProgress(args, rec.duration, report, { signal: ctx.signal });
        hasProxy = true;
      }

      await updateMedia(id, { status: 'ready', stage: null, progress: 1, hasThumb, hasEnvelope, hasProxy, error: null });
      return { hasProxy };
    } catch (err) {
      await updateMedia(id, { status: 'error', stage: null, error: errorMessage(err) });
      throw err;
    }
  });
}

export async function enqueueTranscribe(id: string, language: string) {
  const existing = jobs.active('transcribe', id);
  if (existing) return existing;
  const rec = await getMedia(id);
  if (!rec || !rec.hasAudio) return null;
  const selected = selectTranscriber();
  if (selected.kind === 'none') {
    await updateMedia(id, { transcript: { status: 'error', progress: 0, error: selected.detail, provider: null, language } });
    return null;
  }
  await updateMedia(id, { transcript: { status: 'queued', progress: 0, error: null, provider: selected.kind, language } });
  return jobs.enqueue('transcribe', id, async (ctx) => {
    const current = await getMedia(id);
    if (!current) throw new Error('Medio no encontrado');
    await updateMedia(id, { transcript: { status: 'running', progress: 0, error: null, provider: selected.kind, language } });
    const report = throttled((p) => {
      ctx.progress(p);
      void updateMedia(id, { transcript: { ...current.transcript, status: 'running', progress: p, provider: selected.kind, language, error: null } });
    });
    try {
      const { words, provider } = await transcribeMedia(current, language, { ...ctx, progress: report });
      await writeTranscript({ mediaId: id, language, provider, createdAt: new Date().toISOString(), words });
      await updateMedia(id, { transcript: { status: 'done', progress: 1, error: null, provider, language } });
      return { words: words.length };
    } catch (err) {
      await updateMedia(id, { transcript: { status: 'error', progress: 0, error: errorMessage(err), provider: selected.kind, language } });
      throw err;
    }
  });
}

/** Restarts work that was interrupted (e.g. the server restarted mid-job). */
export async function resumeInterrupted(rec: MediaRecord) {
  if (rec.status === 'processing' && !jobs.active('ingest', rec.id)) enqueueIngest(rec.id);
  if ((rec.transcript.status === 'queued' || rec.transcript.status === 'running') && !jobs.active('transcribe', rec.id)) {
    await enqueueTranscribe(rec.id, rec.transcript.language || config.defaultLanguage);
  }
}

export { ENVELOPE_RATE };
