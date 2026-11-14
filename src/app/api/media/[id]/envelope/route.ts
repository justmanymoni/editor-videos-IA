import { existsSync } from 'node:fs';
import { getMedia, mediaPaths } from '@/lib/server/media-store';
import { notFound, sendFile } from '@/lib/server/http';

/** Loudness envelope: one byte (dBFS + 100) per 10 ms. ?stem=voice for the separated voice. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const rec = await getMedia((await ctx.params).id);
  if (!rec?.hasEnvelope) return notFound('Sin análisis de audio');
  const paths = mediaPaths(rec.id);
  const voice = new URL(req.url).searchParams.get('stem') === 'voice';
  if (voice && !existsSync(paths.voiceEnvelope)) return notFound('Sin pista de voz');
  return sendFile(req, voice ? paths.voiceEnvelope : paths.envelope, { contentType: 'application/octet-stream', cache: 'no-cache' });
}
