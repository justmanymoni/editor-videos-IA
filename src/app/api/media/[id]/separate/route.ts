import { errorResponse, notFound } from '@/lib/server/http';
import { getMedia, toPublic } from '@/lib/server/media-store';
import { enqueueSeparation } from '@/lib/server/separation';

/** POST — separates the clip's voice and music (background job). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = (await ctx.params).id;
  const rec = await getMedia(id);
  if (!rec) return notFound('Medio no encontrado');
  if (!rec.hasAudio) return errorResponse(new Error('Este clip no tiene audio'), 400);
  const job = await enqueueSeparation(id);
  return Response.json({ job, media: toPublic((await getMedia(id))!) });
}
