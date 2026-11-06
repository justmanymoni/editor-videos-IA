import type { Envelope, JobInfo, MediaInfo, ProjectDoc, ProjectSummary, ServerStatus, Transcript } from '@/lib/shared/types';

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
  createProject: (name: string, doc?: ProjectDoc) =>
    request<{ project: ProjectDoc }>('/api/projects', jsonBody({ name, doc })).then((r) => r.project),
  project: (id: string) => request<{ project: ProjectDoc }>(`/api/projects/${id}`).then((r) => r.project),
  saveProject: (doc: ProjectDoc) =>
    request<{ updatedAt: string }>(`/api/projects/${doc.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    }),
  deleteProject: (id: string) => request(`/api/projects/${id}`, { method: 'DELETE' }),
  media: (ids: string[]) =>
    ids.length ? request<{ media: MediaInfo[] }>(`/api/media?ids=${ids.join(',')}`).then((r) => r.media) : Promise.resolve([]),
  transcript: (id: string) => request<{ transcript: Transcript }>(`/api/media/${id}/transcript`).then((r) => r.transcript),
  retranscribe: (id: string, language: string) =>
    request<{ media: MediaInfo }>(`/api/media/${id}/transcript`, jsonBody({ language })).then((r) => r.media),
  envelope: async (id: string): Promise<Envelope> => {
    const res = await fetch(`/api/media/${id}/envelope`);
    if (!res.ok) throw new Error('Sin análisis de audio');
    return { rate: 100, values: new Uint8Array(await res.arrayBuffer()) };
  },
  resources: () => request<{ dir: string; media: MediaInfo[] }>('/api/resources'),
  startExport: (doc: ProjectDoc, quality: string) => request<{ job: JobInfo }>('/api/export', jsonBody({ doc, quality })).then((r) => r.job),
  exports: () => request<{ exports: { name: string; url: string; size: number; createdAt: string }[] }>('/api/export').then((r) => r.exports),
  job: (id: string) => request<{ job: JobInfo }>(`/api/jobs/${id}`).then((r) => r.job),
  cancelJob: (id: string) => request(`/api/jobs/${id}`, { method: 'DELETE' }),
};

export const mediaUrl = {
  preview: (m: MediaInfo) => `/api/media/${m.id}/file?v=preview&p=${m.hasProxy ? 1 : 0}`,
  thumb: (m: MediaInfo) => (m.hasThumb ? `/api/media/${m.id}/thumb` : null),
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
