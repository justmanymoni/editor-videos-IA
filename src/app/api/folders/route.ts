import { errorResponse } from '@/lib/server/http';
import { createFolder, listFolders, moveProjects } from '@/lib/server/library';

export const dynamic = 'force-dynamic';

const ids = (value: unknown) => (Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string').slice(0, 500) : []);

/** GET — the folders of the home screen. */
export async function GET() {
  return Response.json({ folders: await listFolders() });
}

/** POST { name, projectIds? } — creates a folder with those projects in it. */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: string; projectIds?: unknown };
    return Response.json({ folder: await createFolder(String(body.name ?? ''), ids(body.projectIds)) });
  } catch (err) {
    return errorResponse(err, 400);
  }
}

/** PUT { projectIds, folderId } — moves projects into a folder, or out of any folder when folderId is null. */
export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as { projectIds?: unknown; folderId?: string | null };
    await moveProjects(ids(body.projectIds), typeof body.folderId === 'string' ? body.folderId : null);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err, 400);
  }
}
