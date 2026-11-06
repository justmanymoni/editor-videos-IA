import { getMedia, mediaPaths } from '@/lib/server/media-store';
import { notFound, sendFile } from '@/lib/server/http';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const rec = await getMedia((await ctx.params).id);
  if (!rec?.hasThumb) return notFound('Sin miniatura');
  return sendFile(req, mediaPaths(rec.id).thumb, { contentType: 'image/jpeg', cache: 'public, max-age=86400' });
}
