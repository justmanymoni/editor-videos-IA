import path from 'node:path';
import { errorResponse } from '@/lib/server/http';
import { toPublic } from '@/lib/server/media-store';
import { scanResources, uploadResource } from '@/lib/server/resources';
import { config } from '@/lib/server/config';

export const dynamic = 'force-dynamic';

/** GET — scans the resources folder (B-roll and music). */
export async function GET() {
  try {
    const list = await scanResources();
    return Response.json({ dir: config.resourcesDir, media: list.map(toPublic) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST ?name=file.ext — raw body, saved into the resources folder. */
export async function POST(req: Request) {
  const name = path.basename(new URL(req.url).searchParams.get('name') || '');
  if (!name || !req.body) return errorResponse(new Error('Falta el archivo'), 400);
  try {
    return Response.json({ media: toPublic(await uploadResource(name, req.body)) });
  } catch (err) {
    return errorResponse(err, 400);
  }
}
