/**
 * Folders of the home screen, general settings and how new projects use
 * them. Works on a throw-away storage folder.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_APP_SETTINGS } from '@/lib/shared/types';
import { SUBTITLE_PRESETS, presetStyle } from '@/lib/shared/subtitle-presets';

const dir = mkdtempSync(path.join(tmpdir(), 'verticut-library-'));
const previous = process.env.STORAGE_DIR;

beforeAll(() => {
  process.env.STORAGE_DIR = dir;
});
afterAll(() => {
  if (previous === undefined) delete process.env.STORAGE_DIR;
  else process.env.STORAGE_DIR = previous;
  rmSync(dir, { recursive: true, force: true });
});

describe('general settings', () => {
  it('start with the defaults and keep only valid values', async () => {
    const { getAppSettings, saveAppSettings, sanitizeAppSettings } = await import('@/lib/server/app-settings');
    expect(await getAppSettings()).toMatchObject({ autoSilence: true, exportQuality: 'normal', subtitlePreset: 'montserrat' });
    const saved = await saveAppSettings({ language: 'en', exportQuality: 'high', silenceMin: 9, subtitlePreset: 'caja' });
    expect(saved).toMatchObject({ language: 'en', exportQuality: 'high', silenceMin: 3, subtitlePreset: 'caja' });
    expect(await getAppSettings()).toEqual(saved);
    // Nonsense is ignored, field by field.
    const bad = sanitizeAppSettings(
      { language: '../x', exportQuality: 'ultra' as never, fitMode: 'zoom' as never, subtitlePreset: 'nope', autoSilence: 'yes' as never },
      DEFAULT_APP_SETTINGS,
    );
    expect(bad).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('every quick style has an id and gives a complete style', () => {
    expect(new Set(SUBTITLE_PRESETS.map((p) => p.id)).size).toBe(SUBTITLE_PRESETS.length);
    expect(presetStyle('caja').highlightBox).toBe(true);
    expect(presetStyle('does-not-exist')).toEqual(presetStyle('montserrat'));
  });
});

describe('folders of the home screen', () => {
  it('creates folders, moves projects in and out and forgets deleted ones', async () => {
    const lib = await import('@/lib/server/library');
    const projects = await import('@/lib/server/projects');
    const a = await projects.createProject('A');
    const b = await projects.createProject('B');
    const folder = await lib.createFolder('  Clientes   2026 ', [a.id]);
    expect(folder.name).toBe('Clientes 2026');
    const inFolder = async () => Object.fromEntries((await projects.listProjects()).map((p) => [p.name, p.folderId]));
    expect(await inFolder()).toEqual({ A: folder.id, B: null });

    await lib.moveProjects([b.id], folder.id);
    expect(await inFolder()).toEqual({ A: folder.id, B: folder.id });
    await lib.moveProjects([a.id], null);
    expect(await inFolder()).toEqual({ A: null, B: folder.id });
    await expect(lib.moveProjects([a.id], 'no-such-folder')).rejects.toThrow();

    // A project created inside a folder stays in it; a duplicate keeps its content.
    const c = await projects.createProject('C', undefined, folder.id);
    expect((await inFolder()).C).toBe(folder.id);
    await projects.deleteProject(c.id);
    expect(Object.keys(await lib.projectFolders())).not.toContain(c.id);

    expect((await lib.renameFolder(folder.id, 'Trabajo'))?.name).toBe('Trabajo');
    expect(await lib.renameFolder('missing', 'x')).toBeNull();
    // Removing a folder never deletes its projects.
    await lib.deleteFolder(folder.id);
    expect(await lib.listFolders()).toEqual([]);
    expect(await inFolder()).toEqual({ A: null, B: null });
  });

  it('gives new projects the general settings', async () => {
    const { saveAppSettings } = await import('@/lib/server/app-settings');
    const projects = await import('@/lib/server/projects');
    await saveAppSettings({ language: 'fr', autoSilence: false, silenceMin: 0.8, fitMode: 'blur', subtitlePreset: 'karaoke' });
    const doc = await projects.createProject('Nuevo');
    expect(doc.settings).toMatchObject({ language: 'fr', autoSilence: false, silenceMin: 0.8, fitMode: 'blur' });
    expect(doc.subtitles.dimUpcoming).toBe(true);
    // An imported project keeps its own settings.
    const copy = await projects.createProject('Copia', { ...doc, settings: { ...doc.settings, language: 'de' } });
    expect(copy.settings.language).toBe('de');
  });
});
