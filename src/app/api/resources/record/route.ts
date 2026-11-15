import { errorResponse } from '@/lib/server/http';
import { toPublic } from '@/lib/server/media-store';
import { saveRecording } from '@/lib/server/resources';

/** POST — microphone recording (raw body). Saved as audio in the resources folder. */
export async function POST(req: Request) {
  if (!req.body) return errorResponse(new Error('Falta el audio'), 400);
  try {
    return Response.json({ media: toPublic(await saveRecording(req.body)) });
  } catch (err) {
    return errorResponse(err, 400);
  }
}
