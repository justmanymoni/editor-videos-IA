/**
 * Makes the filmstrip of a video: one small frame every so often, packed in a
 * single JPEG that the timeline draws along the clip. It runs on its own
 * after the clip is ready, so it never delays editing.
 */
import { existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { filmstripLayout, filmstripRows } from '../shared/filmstrip';
import { ffmpeg } from './ffmpeg';
import { jobs } from './jobs';
import { getMedia, mediaPaths, updateMedia } from './media-store';

export function enqueueFilmstrip(id: string) {
  if (jobs.active('filmstrip', id)) return;
  jobs.enqueue('filmstrip', id, async (ctx) => {
    const rec = await getMedia(id);
    if (!rec || rec.kind !== 'video' || rec.duration <= 0) return;
    const paths = mediaPaths(id);
    const layout = filmstripLayout(rec.duration, rec.width, rec.height);
    // The proxy, when there is one, is the version every FFmpeg build decodes quickly.
    const source = rec.hasProxy && existsSync(paths.proxy) ? paths.proxy : rec.sourcePath;
    const part = `${paths.filmstrip}.part.jpg`;
    try {
      // prettier-ignore
      await ffmpeg([
        '-y', '-loglevel', 'error', '-i', source, '-an', '-sn',
        '-vf', `fps=${(1 / layout.interval).toFixed(5)},scale=${layout.tileW}:${layout.tileH},tile=${layout.cols}x${filmstripRows(layout)}`,
        '-frames:v', '1', '-update', '1', '-q:v', '6', part,
      ], { signal: ctx.signal });
      await rename(part, paths.filmstrip);
      await updateMedia(id, { filmstrip: layout });
    } catch (err) {
      // Marked as "could not be made" so it is not attempted over and over.
      if (!ctx.signal.aborted) await updateMedia(id, { filmstrip: null });
      throw err;
    }
  });
}
