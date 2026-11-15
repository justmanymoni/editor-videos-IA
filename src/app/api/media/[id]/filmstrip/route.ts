import { getMedia, mediaPaths } from '@/lib/server/media-store';
import { notFound, sendFile } from '@/lib/server/http';

/** GET — the frames of the video packed in one image (see shared/filmstrip). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const rec = await getMedia((await ctx.params).id);
  if (!rec?.filmstrip) return notFound('Sin fotogramas');
  return sendFile(req, mediaPaths(rec.id).filmstrip, { contentType: 'image/jpeg', cache: 'public, max-age=86400' });
}
