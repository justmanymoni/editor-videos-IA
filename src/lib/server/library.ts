/**
 * Folders of the home screen: which folders exist and which project is in
 * which one. Kept apart from the project files (storage/library.json), so
 * moving projects around never touches them.
 */
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { nanoid } from 'nanoid';
import type { Folder } from '../shared/types';
import { config } from './config';
import { writeJsonAtomic } from './media-store';

interface Library {
  folders: Folder[];
  /** Project id → folder id. Projects that are not listed are at the top level. */
  projectFolder: Record<string, string>;
}

const file = () => path.join(config.storageDir, 'library.json');

async function read(): Promise<Library> {
  try {
    const raw = JSON.parse(await readFile(file(), 'utf8')) as Partial<Library>;
    const folders = (raw.folders ?? []).filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string');
    const ids = new Set(folders.map((f) => f.id));
    // Forget projects that point to a folder that no longer exists.
    const projectFolder = Object.fromEntries(Object.entries(raw.projectFolder ?? {}).filter(([, folder]) => ids.has(folder)));
    return { folders, projectFolder };
  } catch {
    return { folders: [], projectFolder: {} };
  }
}

const write = (lib: Library) => writeJsonAtomic(file(), lib);
const cleanName = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, 80);

export const listFolders = async () => (await read()).folders;
export const projectFolders = async () => (await read()).projectFolder;

/** Creates a folder and, optionally, puts some projects in it. */
export async function createFolder(name: string, projectIds: string[] = []): Promise<Folder> {
  const lib = await read();
  const folder: Folder = { id: nanoid(10), name: cleanName(name) || 'Carpeta nueva', createdAt: new Date().toISOString() };
  lib.folders.push(folder);
  for (const id of projectIds) lib.projectFolder[id] = folder.id;
  await write(lib);
  return folder;
}

export async function renameFolder(id: string, name: string): Promise<Folder | null> {
  const lib = await read();
  const folder = lib.folders.find((f) => f.id === id);
  if (!folder) return null;
  folder.name = cleanName(name) || folder.name;
  await write(lib);
  return folder;
}

/** Removes a folder. Its projects are not deleted: they go back to the top level. */
export async function deleteFolder(id: string): Promise<void> {
  const lib = await read();
  lib.folders = lib.folders.filter((f) => f.id !== id);
  for (const [project, folder] of Object.entries(lib.projectFolder)) if (folder === id) delete lib.projectFolder[project];
  await write(lib);
}

/** Puts projects in a folder, or takes them out of any folder when `folderId` is null. */
export async function moveProjects(projectIds: string[], folderId: string | null): Promise<void> {
  const lib = await read();
  if (folderId && !lib.folders.some((f) => f.id === folderId)) throw new Error('La carpeta ya no existe');
  for (const id of projectIds) {
    if (folderId) lib.projectFolder[id] = folderId;
    else delete lib.projectFolder[id];
  }
  await write(lib);
}

/** A project was deleted: it is in no folder any more. */
export async function forgetProject(id: string): Promise<void> {
  const lib = await read();
  if (!(id in lib.projectFolder)) return;
  delete lib.projectFolder[id];
  await write(lib);
}
