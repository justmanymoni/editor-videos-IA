import type { ProjectDoc } from '@/lib/shared/types';
import { normalizeProjectDoc } from '@/lib/shared/types';
import { errorResponse } from '@/lib/server/http';
import { jobs } from '@/lib/server/jobs';
import { listExports, runExport, type ExportQuality } from '@/lib/server/export';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ exports: await listExports() });
}

/** POST { doc, quality } — queues an MP4 render and returns the job. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { doc?: ProjectDoc; quality?: ExportQuality };
    if (!body.doc || !Array.isArray(body.doc.clips)) throw new Error('Falta el proyecto');
    const doc = normalizeProjectDoc(body.doc);
    const quality: ExportQuality = body.quality === 'high' || body.quality === 'fast' ? body.quality : 'normal';
    const job = jobs.enqueue('export', doc.id, (ctx) => runExport(doc, quality, ctx));
    return Response.json({ job });
  } catch (err) {
    return errorResponse(err, 400);
  }
}
