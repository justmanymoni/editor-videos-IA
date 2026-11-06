import type { ServerStatus } from '@/lib/shared/types';
import { config, selectTranscriber } from '@/lib/server/config';
import { ffmpegVersion } from '@/lib/server/ffmpeg';

export const dynamic = 'force-dynamic';

export async function GET() {
  const t = selectTranscriber();
  const status: ServerStatus = {
    transcriber: t.kind,
    transcriberDetail: t.detail,
    ffmpeg: await ffmpegVersion(),
    resourcesDir: config.resourcesDir,
    defaultLanguage: config.defaultLanguage,
  };
  return Response.json(status);
}
