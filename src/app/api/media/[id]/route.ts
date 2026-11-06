import { getMedia, toPublic } from '@/lib/server/media-store';
import { notFound } from '@/lib/server/http';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const rec = await getMedia((await ctx.params).id);
  return rec ? Response.json({ media: toPublic(rec) }) : notFound('Medio no encontrado');
}
