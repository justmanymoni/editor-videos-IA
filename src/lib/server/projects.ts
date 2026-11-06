import path from 'node:path';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { nanoid } from 'nanoid';
import type { ProjectDoc, ProjectSummary } from '../shared/types';
import { createProjectDoc, normalizeProjectDoc } from '../shared/types';
import { config } from './config';
import { isValidId, writeJsonAtomic } from './media-store';

const dir = () => path.join(config.storageDir, 'projects');
const fileOf = (id: string) => path.join(dir(), `${id}.json`);

export async function listProjects(): Promise<ProjectSummary[]> {
  await mkdir(dir(), { recursive: true });
  const out: ProjectSummary[] = [];
  for (const f of await readdir(dir())) {
    if (!f.endsWith('.json')) continue;
    try {
      const doc = JSON.parse(await readFile(path.join(dir(), f), 'utf8')) as ProjectDoc;
      out.push({ id: doc.id, name: doc.name, createdAt: doc.createdAt, updatedAt: doc.updatedAt, clipCount: doc.clips?.length ?? 0 });
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

export async function createProject(name: string, from?: ProjectDoc): Promise<ProjectDoc> {
  const id = nanoid(10);
  const doc = from
    ? normalizeProjectDoc({ ...from, id, name: name || from.name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    : createProjectDoc(id, name || 'Proyecto sin título', config.defaultLanguage);
  await writeJsonAtomic(fileOf(id), doc);
  return doc;
}

export async function saveProject(doc: ProjectDoc): Promise<ProjectDoc> {
  if (!isValidId(doc.id)) throw new Error('Id de proyecto no válido');
  const saved = normalizeProjectDoc({ ...doc, updatedAt: new Date().toISOString() });
  await writeJsonAtomic(fileOf(doc.id), saved);
  return saved;
}

export async function deleteProject(id: string) {
  if (!isValidId(id)) return;
  await rm(fileOf(id), { force: true });
}
