import path from 'node:path';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { nanoid } from 'nanoid';
import type { ProjectDoc, ProjectSummary } from '../shared/types';
import { createProjectDoc, normalizeProjectDoc } from '../shared/types';
import { config } from './config';
import { isValidId, writeJsonAtomic } from './media-store';
import { presetStyle } from '../shared/subtitle-presets';
import { getAppSettings } from './app-settings';
import { forgetProject, moveProjects, projectFolders } from './library';

const dir = () => path.join(config.storageDir, 'projects');
const fileOf = (id: string) => path.join(dir(), `${id}.json`);

export async function listProjects(): Promise<ProjectSummary[]> {
  await mkdir(dir(), { recursive: true });
  const folders = await projectFolders();
  const out: ProjectSummary[] = [];
  for (const f of await readdir(dir())) {
    if (!f.endsWith('.json')) continue;
    try {
      const doc = JSON.parse(await readFile(path.join(dir(), f), 'utf8')) as ProjectDoc;
      out.push({
        id: doc.id,
        name: doc.name,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        clipCount: doc.clips?.length ?? 0,
        thumbMediaId: doc.clips?.[0]?.mediaId ?? doc.broll?.[0]?.mediaId ?? null,
        folderId: folders[doc.id] ?? null,
      });
    } catch {
      // Ignore unreadable files.
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getProject(id: string): Promise<ProjectDoc | null> {
  if (!isValidId(id)) return null;
  try {
    return normalizeProjectDoc(JSON.parse(await readFile(fileOf(id), 'utf8')) as ProjectDoc);
  } catch {
    return null;
  }
}

/**
 * Creates a project: a copy of `from` (import, duplicate) or an empty one
 * that starts with the general settings of the app. With `folderId` it is
 * placed in that folder of the home screen.
 */
export async function createProject(name: string, from?: ProjectDoc, folderId?: string | null): Promise<ProjectDoc> {
  const id = nanoid(10);
  let doc: ProjectDoc;
  if (from) {
    doc = normalizeProjectDoc({ ...from, id, name: name || from.name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  } else {
    const app = await getAppSettings();
    doc = createProjectDoc(id, name || 'Proyecto sin título', app.language);
    doc.settings = { ...doc.settings, autoSilence: app.autoSilence, silenceMin: app.silenceMin, fitMode: app.fitMode };
    doc.subtitles = { ...presetStyle(app.subtitlePreset), enabled: app.autoSubtitles };
  }
  await writeJsonAtomic(fileOf(id), doc);
  if (folderId) await moveProjects([id], folderId).catch(() => undefined);
  return doc;
}

export async function saveProject(doc: ProjectDoc): Promise<ProjectDoc> {
  if (!isValidId(doc.id)) throw new Error('Id de proyecto no válido');
  const saved = normalizeProjectDoc({ ...doc, updatedAt: new Date().toISOString() });
  await writeJsonAtomic(fileOf(doc.id), saved);
  return saved;
}

/** Changes only the name; the project keeps its place in the list (same update time). */
export async function renameProject(id: string, name: string): Promise<ProjectDoc | null> {
  const doc = await getProject(id);
  if (!doc) return null;
  const renamed = { ...doc, name: name.trim() || doc.name };
  await writeJsonAtomic(fileOf(id), renamed);
  return renamed;
}

export async function deleteProject(id: string) {
  if (!isValidId(id)) return;
  await rm(fileOf(id), { force: true });
  await forgetProject(id);
}
