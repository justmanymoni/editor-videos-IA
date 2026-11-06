import path from 'node:path';
import { exportsDir } from '@/lib/server/export';
import { notFound, sendFile } from '@/lib/server/http';

type Ctx = { params: Promise<{ name: string }> };

async function handle(req: Request, ctx: Ctx) {
  const name = path.basename(decodeURIComponent((await ctx.params).name));
  if (!name.endsWith('.mp4') || name.startsWith('.')) return notFound();
  const download = new URL(req.url).searchParams.has('download');
  return sendFile(req, path.join(exportsDir(), name), { contentType: 'video/mp4', downloadName: download ? name : undefined });
}

export const GET = handle;
export const HEAD = handle;
