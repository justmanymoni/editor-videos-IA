import type { ProjectDoc } from '@/lib/shared/types';
import { errorResponse } from '@/lib/server/http';
import { createProject, listProjects } from '@/lib/server/projects';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ projects: await listProjects() });
}

/** POST { name, doc? } — creates a project (optionally from an imported JSON). */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: string; doc?: ProjectDoc };
    if (body.doc && (typeof body.doc !== 'object' || !Array.isArray(body.doc.clips))) throw new Error('El JSON no es un proyecto válido');
    return Response.json({ project: await createProject(String(body.name ?? '').slice(0, 120), body.doc) });
  } catch (err) {
    return errorResponse(err, 400);
  }
}
