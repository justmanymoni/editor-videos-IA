import { existsSync } from 'node:fs';
import { getMedia, mediaPaths } from '@/lib/server/media-store';
import { notFound, sendFile } from '@/lib/server/http';

/** GET /api/media/:id/file?v=preview|source — supports Range requests. */
async function handle(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const rec = await getMedia((await ctx.params).id);
  if (!rec) return notFound('Medio no encontrado');
  const variant = new URL(req.url).searchParams.get('v');
  const proxy = mediaPaths(rec.id).proxy;
  if (variant !== 'source' && rec.hasProxy && existsSync(proxy)) return sendFile(req, proxy, { contentType: 'video/mp4' });
  return sendFile(req, rec.sourcePath);
}

export const GET = handle;
export const HEAD = handle;
