import { config } from '@/lib/server/config';
import { errorResponse, notFound } from '@/lib/server/http';
import { enqueueTranscribe } from '@/lib/server/ingest';
import { getMedia, readTranscript, toPublic } from '@/lib/server/media-store';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const t = await readTranscript((await ctx.params).id);
  return t ? Response.json({ transcript: t }) : notFound('Sin transcripción');
}

/** POST { language } — (re)transcribe a clip. */
export async function POST(req: Request, ctx: Ctx) {
  const id = (await ctx.params).id;
  const rec = await getMedia(id);
  if (!rec) return notFound('Medio no encontrado');
  if (!rec.hasAudio) return errorResponse(new Error('Este clip no tiene audio'), 400);
  const body = (await req.json().catch(() => ({}))) as { language?: string };
  const job = await enqueueTranscribe(id, body.language || rec.transcript.language || config.defaultLanguage);
  return Response.json({ job, media: toPublic((await getMedia(id))!) });
}
