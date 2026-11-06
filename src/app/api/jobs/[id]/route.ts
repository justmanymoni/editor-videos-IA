import { jobs } from '@/lib/server/jobs';
import { notFound } from '@/lib/server/http';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const job = jobs.get((await ctx.params).id);
  return job ? Response.json({ job }) : notFound('Trabajo no encontrado');
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return Response.json({ cancelled: jobs.cancel((await ctx.params).id) });
}
