import type { AppSettings, Envelope, Folder, JobInfo, MediaInfo, ProjectDoc, ProjectSummary, ServerStatus, Transcript } from '@/lib/shared/types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

const jsonBody = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  status: () => request<ServerStatus>('/api/status'),
  projects: () => request<{ projects: ProjectSummary[] }>('/api/projects').then((r) => r.projects),
  createProject: (name: string, doc?: ProjectDoc, folderId?: string | null) =>
    request<{ project: ProjectDoc }>('/api/projects', jsonBody({ name, doc, folderId })).then((r) => r.project),
  settings: () => request<{ settings: AppSettings }>('/api/settings').then((r) => r.settings),
  saveSettings: (patch: Partial<AppSettings>) =>
    request<{ settings: AppSettings }>('/api/settings', { ...jsonBody(patch), method: 'PUT' }).then((r) => r.settings),
  folders: () => request<{ folders: Folder[] }>('/api/folders').then((r) => r.folders),
  createFolder: (name: string, projectIds: string[] = []) =>
    request<{ folder: Folder }>('/api/folders', jsonBody({ name, projectIds })).then((r) => r.folder),
  renameFolder: (id: string, name: string) => request<{ folder: Folder }>(`/api/folders/${id}`, { ...jsonBody({ name }), method: 'PATCH' }),
  deleteFolder: (id: string) => request(`/api/folders/${id}`, { method: 'DELETE' }),
  /** Puts projects in a folder; `folderId` null takes them out. */
  moveProjects: (projectIds: string[], folderId: string | null) => request('/api/folders', { ...jsonBody({ projectIds, folderId }), method: 'PUT' }),
  project: (id: string) => request<{ project: ProjectDoc }>(`/api/projects/${id}`).then((r) => r.project),
  saveProject: (doc: ProjectDoc) =>
    request<{ updatedAt: string }>(`/api/projects/${doc.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    }),
  renameProject: (id: string, name: string) =>
    request<{ name: string }>(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  deleteProject: (id: string) => request(`/api/projects/${id}`, { method: 'DELETE' }),
  media: (ids: string[]) =>
    ids.length ? request<{ media: MediaInfo[] }>(`/api/media?ids=${ids.join(',')}`).then((r) => r.media) : Promise.resolve([]),
  transcript: (id: string) => request<{ transcript: Transcript }>(`/api/media/${id}/transcript`).then((r) => r.transcript),
  retranscribe: (id: string, language: string) =>
    request<{ media: MediaInfo }>(`/api/media/${id}/transcript`, jsonBody({ language })).then((r) => r.media),
  envelope: async (id: string, stem?: 'voice'): Promise<Envelope> => {
    const res = await fetch(`/api/media/${id}/envelope${stem ? `?stem=${stem}` : ''}`);
    if (!res.ok) throw new Error('Sin análisis de audio');
    return { rate: 100, values: new Uint8Array(await res.arrayBuffer()) };
  },
  resources: () => request<{ dir: string; media: MediaInfo[] }>('/api/resources'),
  startExport: (doc: ProjectDoc, quality: string, texts: { id: string; dataUrl: string; width: number; height: number }[] = []) =>
    request<{ job: JobInfo }>('/api/export', jsonBody({ doc, quality, texts })).then((r) => r.job),
  exports: () => request<{ exports: { name: string; url: string; size: number; createdAt: string }[] }>('/api/export').then((r) => r.exports),
  job: (id: string) => request<{ job: JobInfo }>(`/api/jobs/${id}`).then((r) => r.job),
  cancelJob: (id: string) => request(`/api/jobs/${id}`, { method: 'DELETE' }),
  separate: (id: string) => request<{ media: MediaInfo }>(`/api/media/${id}/separate`, jsonBody({})).then((r) => r.media),
  /** Preview of a separated clip with the voice and the music on separate channels. */
  stemsPreview: (id: string) => request<{ url?: string; jobId?: string }>(`/api/media/${id}/mix`, jsonBody({})),
  dictate: async (audio: Blob, lang: string) => (await request<{ text: string }>(`/api/dictate?lang=${lang}`, { method: 'POST', body: audio })).text,
  record: async (audio: Blob) => (await request<{ media: MediaInfo }>('/api/resources/record', { method: 'POST', body: audio })).media,
  installWhisper: (model: string) => request<{ job: JobInfo }>('/api/whisper/setup', jsonBody({ model })).then((r) => r.job),
};

export const mediaUrl = {
  preview: (m: MediaInfo) => `/api/media/${m.id}/file?v=preview&p=${m.hasProxy ? 1 : 0}`,
  thumb: (m: MediaInfo) => (m.hasThumb ? `/api/media/${m.id}/thumb` : null),
  filmstrip: (m: MediaInfo) => (m.filmstrip ? `/api/media/${m.id}/filmstrip` : null),
};

/** Uploads a file as the raw request body, reporting progress (0..1). */
export function uploadFile(url: string, file: File, onProgress: (p: number) => void): Promise<MediaInfo> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: { media?: MediaInfo; error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // keep empty
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.media) resolve(data.media);
      else reject(new Error(data.error || `Error ${xhr.status} al subir ${file.name}`));
    };
    xhr.onerror = () => reject(new Error(`No se pudo subir ${file.name}`));
    xhr.send(file);
  });
}
