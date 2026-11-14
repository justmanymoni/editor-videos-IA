import path from 'node:path';
import type { ServerStatus } from '@/lib/shared/types';
import { config, selectTranscriber, whisperCppBinary, whisperCppModel } from '@/lib/server/config';
import { ffmpegVersion, ffprobeAvailable } from '@/lib/server/ffmpeg';
import { jobs } from '@/lib/server/jobs';
import { releaseAsset } from '@/lib/server/whisper-setup';

export const dynamic = 'force-dynamic';

export async function GET() {
  const t = selectTranscriber();
  const binary = whisperCppBinary();
  const model = whisperCppModel();
  const status: ServerStatus = {
    transcriber: t.kind,
    transcriberDetail: t.detail,
    ffmpeg: await ffmpegVersion(),
    ffprobe: await ffprobeAvailable(),
    resourcesDir: config.resourcesDir,
    defaultLanguage: config.defaultLanguage,
    local: {
      binary,
      model: model ? path.basename(model) : null,
      canInstall: !!binary || !!releaseAsset(),
      platform: process.platform,
      setupJobId: jobs.active('setup', 'whisper')?.id ?? null,
    },
  };
  return Response.json(status);
}
