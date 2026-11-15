import { stat } from 'node:fs/promises';
import { errorResponse, notFound, sendFile } from '@/lib/server/http';
import { getMedia, mediaPaths } from '@/lib/server/media-store';
import { stemsPreview } from '@/lib/server/separation';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST — prepares the "stems" preview of a separated clip (voice on the left
 * channel, music on the right). Returns its url, or a job to wait for.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const id = (await ctx.params).id;
  if (!(await getMedia(id))) return notFound('Medio no encontrado');
  try {
    const res = await stemsPreview(id);
    if ('jobId' in res) return Response.json({ jobId: res.jobId });
    // The file's date in the url makes the browser load a preview that was made again.
    const made = Math.round((await stat(res.file)).mtimeMs);
    return Response.json({ url: `/api/media/${id}/mix?t=${made}` });
  } catch (err) {
    return errorResponse(err, 400);
  }
}

/** GET — the prepared preview video (Range requests supported). */
async function serve(req: Request, ctx: Ctx) {
  const id = (await ctx.params).id;
  if (!(await getMedia(id))) return notFound('Medio no encontrado');
  return sendFile(req, mediaPaths(id).stems, { contentType: 'video/mp4' });
}

export const GET = serve;
export const HEAD = serve;
