import type { ProjectDoc } from '@/lib/shared/types';
import { errorResponse, notFound } from '@/lib/server/http';
import { deleteProject, getProject, saveProject } from '@/lib/server/projects';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const doc = await getProject((await ctx.params).id);
  return doc ? Response.json({ project: doc }) : notFound('Proyecto no encontrado');
}

export async function PUT(req: Request, ctx: Ctx) {
  const id = (await ctx.params).id;
  try {
    const doc = (await req.json()) as ProjectDoc;
    if (doc.id !== id || !Array.isArray(doc.clips)) throw new Error('Proyecto no válido');
    const saved = await saveProject(doc);
    return Response.json({ updatedAt: saved.updatedAt });
  } catch (err) {
    return errorResponse(err, 400);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  await deleteProject((await ctx.params).id);
  return Response.json({ ok: true });
}
