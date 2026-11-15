import type { ProjectDoc } from '@/lib/shared/types';
import { normalizeProjectDoc } from '@/lib/shared/types';
import { errorResponse } from '@/lib/server/http';
import { jobs } from '@/lib/server/jobs';
import { listExports, runExport, type ExportQuality, type TextPng } from '@/lib/server/export';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ exports: await listExports() });
}

/** POST { doc, quality, texts } — queues an MP4 render. `texts` are the manual texts rendered to PNG by the editor. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      doc?: ProjectDoc;
      quality?: ExportQuality;
      texts?: { id: string; dataUrl: string; width: number; height: number }[];
    };
    if (!body.doc || !Array.isArray(body.doc.clips)) throw new Error('Falta el proyecto');
    const doc = normalizeProjectDoc(body.doc);
    const quality: ExportQuality = body.quality === 'high' || body.quality === 'fast' ? body.quality : 'normal';
    const texts: TextPng[] = (body.texts ?? [])
      .filter((t) => typeof t.dataUrl === 'string' && t.dataUrl.startsWith('data:image/png;base64,'))
      .map((t) => ({ id: t.id, png: Buffer.from(t.dataUrl.slice(22), 'base64'), width: Math.round(t.width), height: Math.round(t.height) }));
    const job = jobs.enqueue('export', doc.id, (ctx) => runExport(doc, quality, ctx, texts));
    return Response.json({ job });
  } catch (err) {
    return errorResponse(err, 400);
  }
}
