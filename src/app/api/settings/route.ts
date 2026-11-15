import type { AppSettings } from '@/lib/shared/types';
import { errorResponse } from '@/lib/server/http';
import { getAppSettings, saveAppSettings } from '@/lib/server/app-settings';

export const dynamic = 'force-dynamic';

/** GET — the general settings of the app. */
export async function GET() {
  return Response.json({ settings: await getAppSettings() });
}

/** PUT { …some settings } — changes them and returns all of them. */
export async function PUT(req: Request) {
  try {
    const patch = (await req.json()) as Partial<AppSettings>;
    if (!patch || typeof patch !== 'object') throw new Error('Ajustes no válidos');
    return Response.json({ settings: await saveAppSettings(patch) });
  } catch (err) {
    return errorResponse(err, 400);
  }
}
