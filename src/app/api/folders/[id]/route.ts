import { errorResponse, notFound } from '@/lib/server/http';
import { deleteFolder, renameFolder } from '@/lib/server/library';

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { name } — renames the folder. */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { name } = (await req.json()) as { name?: string };
    if (typeof name !== 'string' || !name.trim()) throw new Error('Escribe un nombre');
    const folder = await renameFolder((await ctx.params).id, name);
    return folder ? Response.json({ folder }) : notFound('Carpeta no encontrada');
  } catch (err) {
    return errorResponse(err, 400);
  }
}

/** DELETE — removes the folder; its projects go back to the top level. */
export async function DELETE(_req: Request, ctx: Ctx) {
  await deleteFolder((await ctx.params).id);
  return Response.json({ ok: true });
}
