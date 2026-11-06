import { getMedia, mediaPaths } from '@/lib/server/media-store';
import { notFound, sendFile } from '@/lib/server/http';

/** Loudness envelope: one byte (dBFS + 100) per 10 ms. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const rec = await getMedia((await ctx.params).id);
  if (!rec?.hasEnvelope) return notFound('Sin análisis de audio');
  return sendFile(req, mediaPaths(rec.id).envelope, { contentType: 'application/octet-stream', cache: 'public, max-age=86400' });
}
