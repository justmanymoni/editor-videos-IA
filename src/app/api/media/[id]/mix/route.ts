import { errorResponse, notFound, sendFile } from '@/lib/server/http';
import { getMedia, mediaPaths } from '@/lib/server/media-store';
import { mixPreview } from '@/lib/server/separation';

type Ctx = { params: Promise<{ id: string }> };

const level = (v: unknown) => Math.round(Math.min(2, Math.max(0, Number(v) || 0)) * 100) / 100;

/** POST { voice, music } — prepares a preview video with that mix. Returns its url or a job to wait for. */
export async function POST(req: Request, ctx: Ctx) {
  const id = (await ctx.params).id;
  if (!(await getMedia(id))) return notFound('Medio no encontrado');
  const body = (await req.json().catch(() => ({}))) as { voice?: number; music?: number };
  const voice = level(body.voice);
  const music = level(body.music);
  try {
    const res = await mixPreview(id, voice, music);
    return Response.json('file' in res ? { url: `/api/media/${id}/mix?v=${voice}&m=${music}` } : { jobId: res.jobId });
  } catch (err) {
    return errorResponse(err, 400);
  }
}

/** GET ?v=&m= — the prepared preview video (Range requests supported). */
async function serve(req: Request, ctx: Ctx) {
  const id = (await ctx.params).id;
  if (!(await getMedia(id))) return notFound('Medio no encontrado');
  const url = new URL(req.url);
  return sendFile(req, mediaPaths(id).mix(level(url.searchParams.get('v')), level(url.searchParams.get('m'))), { contentType: 'video/mp4' });
}

export const GET = serve;
export const HEAD = serve;
