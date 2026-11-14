import { DEFAULT_WHISPER_MODEL, WHISPER_MODELS } from '@/lib/shared/whisper-models';
import { errorResponse } from '@/lib/server/http';
import { startWhisperSetup } from '@/lib/server/whisper-setup';

/** POST { model } — downloads whisper.cpp and the chosen model (runs as a background job). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { model?: string };
  const model = body.model ?? DEFAULT_WHISPER_MODEL;
  if (!WHISPER_MODELS.some((m) => m.id === model)) return errorResponse(new Error(`Modelo desconocido: ${model}`), 400);
  return Response.json({ job: startWhisperSetup(model) });
}
