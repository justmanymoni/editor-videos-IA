/**
 * General settings of the app, kept in storage/settings.json so they apply
 * whatever browser is used. They are the starting point of new projects.
 */
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../shared/types';
import { SUBTITLE_PRESETS } from '../shared/subtitle-presets';
import { config } from './config';
import { writeJsonAtomic } from './media-store';

const file = () => path.join(config.storageDir, 'settings.json');

/** Keeps only valid values; anything else falls back to `base`. */
export function sanitizeAppSettings(raw: Partial<AppSettings> | null | undefined, base: AppSettings): AppSettings {
  const r = raw ?? {};
  const silence = Number(r.silenceMin);
  return {
    language: typeof r.language === 'string' && /^[a-z]{2,8}$/.test(r.language) ? r.language : base.language,
    autoSilence: typeof r.autoSilence === 'boolean' ? r.autoSilence : base.autoSilence,
    silenceMin: Number.isFinite(silence) ? Math.min(2, Math.max(0.2, Math.round(silence * 100) / 100)) : base.silenceMin,
    fitMode: r.fitMode === 'cover' || r.fitMode === 'blur' ? r.fitMode : base.fitMode,
    subtitlePreset: SUBTITLE_PRESETS.some((p) => p.id === r.subtitlePreset) ? r.subtitlePreset! : base.subtitlePreset,
    exportQuality: r.exportQuality === 'fast' || r.exportQuality === 'normal' || r.exportQuality === 'high' ? r.exportQuality : base.exportQuality,
  };
}

export async function getAppSettings(): Promise<AppSettings> {
  // The language of a fresh installation comes from the environment (DEFAULT_LANGUAGE).
  const base = { ...DEFAULT_APP_SETTINGS, language: config.defaultLanguage };
  try {
    return sanitizeAppSettings(JSON.parse(await readFile(file(), 'utf8')) as Partial<AppSettings>, base);
  } catch {
    return base;
  }
}

export async function saveAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getAppSettings();
  const next = sanitizeAppSettings({ ...current, ...patch }, current);
  await writeJsonAtomic(file(), next);
  return next;
}
