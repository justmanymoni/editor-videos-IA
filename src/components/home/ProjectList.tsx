'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Clapperboard, Copy, FileUp, Pencil, Plus, Trash2 } from 'lucide-react';
import type { ProjectDoc, ProjectSummary, ServerStatus } from '@/lib/shared/types';
import { api } from '@/lib/client/api';
import { formatUpdated } from '@/lib/client/format';
import { LocalTranscription } from '@/components/LocalTranscription';

/** A free name such as "Nuevo proyecto 3". */
function newProjectName(projects: ProjectSummary[]) {
  const used = new Set(projects.map((p) => p.name));
  for (let n = 1; ; n++) {
    const name = n === 1 ? 'Nuevo proyecto' : `Nuevo proyecto ${n}`;
    if (!used.has(name)) return name;
  }
}

/** One project: a square thumbnail with its name and the time of its last change underneath, like a folder. */
function ProjectTile({ project, onChanged, onError }: { project: ProjectSummary; onChanged: () => void; onError: (message: string) => void }) {
  const [renaming, setRenaming] = useState(false);
  const [noThumb, setNoThumb] = useState(false);
  const run = (work: () => Promise<unknown>) =>
    work()
      .then(onChanged)
      .catch((e) => onError(e instanceof Error ? e.message : String(e)));

  const rename = (name: string) => {
    setRenaming(false);
    if (name.trim() && name.trim() !== project.name) void run(() => api.renameProject(project.id, name));
  };
  const duplicate = () => run(async () => api.createProject(`${project.name} (copia)`, await api.project(project.id)));
  const remove = () => {
    if (confirm(`¿Borrar "${project.name}"? Los clips subidos se conservan en storage/.`)) void run(() => api.deleteProject(project.id));
  };
  const action = 'flex h-7 w-7 items-center justify-center rounded-md bg-black/70 text-white/90 hover:bg-black hover:text-accent';

  return (
    <li data-project={project.id} className="group flex min-w-0 flex-col gap-2">
      <div className="relative">
        <Link
          href={`/editor/${project.id}`}
          className="block aspect-square overflow-hidden rounded-xl bg-panel-2 ring-1 ring-line transition group-hover:ring-2 group-hover:ring-accent"
          title={`Abrir ${project.name}`}
        >
          {project.thumbMediaId && !noThumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/media/${project.thumbMediaId}/thumb`}
              alt=""
              draggable={false}
              onError={() => setNoThumb(true)}
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-faint">
              <Clapperboard size={34} strokeWidth={1.4} />
            </span>
          )}
        </Link>
        <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <button className={action} onClick={() => setRenaming(true)} title="Cambiar el nombre" aria-label="Cambiar el nombre">
            <Pencil size={13} />
          </button>
          <button className={action} onClick={duplicate} title="Duplicar" aria-label="Duplicar">
            <Copy size={13} />
          </button>
          <button className={`${action} hover:text-danger`} onClick={remove} title="Borrar" aria-label="Borrar">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <div className="min-w-0 px-0.5">
        {renaming ? (
          <input
            autoFocus
            defaultValue={project.name}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => rename(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
            className="w-full rounded border border-accent bg-panel-2 px-1.5 py-0.5 text-sm outline-none"
            aria-label="Nombre del proyecto"
          />
        ) : (
          <p
            className="truncate text-sm font-medium"
            title={`${project.name} (doble clic para cambiar el nombre)`}
            onDoubleClick={() => setRenaming(true)}
          >
            {project.name}
          </p>
        )}
        <p className="mt-0.5 text-xs text-faint">{formatUpdated(project.updatedAt)}</p>
      </div>
    </li>
  );
}

export function ProjectList() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () =>
    api
      .projects()
      .then(setProjects)
      .catch((e) => setError(String(e)));
  useEffect(() => {
    void load();
    api
      .status()
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  const create = async (doc?: ProjectDoc) => {
    setCreating(true);
    try {
      const p = await api.createProject(doc?.name || newProjectName(projects ?? []), doc);
      router.push(`/editor/${p.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCreating(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-7 px-8 py-10">
      <header className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-lg font-black text-black">V</span>
        <h1 className="text-xl font-black tracking-tight">VERTICUT</h1>
      </header>

      {status && (!status.ffmpeg || !status.ffprobe) && (
        <div className="rounded-lg border border-danger/40 bg-danger/5 p-4 text-sm">
          <p className="font-semibold text-danger">Falta FFmpeg{status.ffmpeg ? ' (no se encuentra ffprobe)' : ''}</p>
          <p className="mt-1 text-muted">
            La app lo necesita para leer y exportar los vídeos. En Windows instálalo con <code className="text-fg">winget install Gyan.FFmpeg</code>,
            cierra esta app y vuelve a abrirla. En Mac: <code className="text-fg">brew install ffmpeg</code>.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          data-new-project
          onClick={() => void create()}
          disabled={creating}
          className="flex h-28 min-w-64 flex-1 items-center justify-center gap-3 rounded-xl bg-accent text-base font-bold text-black transition hover:brightness-95 disabled:opacity-60"
        >
          <Plus size={22} strokeWidth={2.6} /> Nuevo proyecto
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="flex h-28 w-52 flex-col items-center justify-center gap-1.5 rounded-xl border border-line bg-panel text-sm text-muted transition hover:border-line-strong hover:text-fg"
          title="Crear un proyecto a partir de un archivo .json exportado"
        >
          <FileUp size={20} /> Importar proyecto
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              await create(JSON.parse(await f.text()) as ProjectDoc);
            } catch {
              setError('El archivo no es un proyecto válido');
            }
          }}
        />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}

      <LocalTranscription status={status} onInstalled={setStatus} />

      <section>
        <h2 className="mb-4 text-sm font-semibold">Proyectos{projects?.length ? ` (${projects.length})` : ''}</h2>
        {projects === null && <p className="text-sm text-faint">Cargando…</p>}
        {projects?.length === 0 && <p className="text-sm text-faint">Todavía no hay proyectos. Pulsa «Nuevo proyecto» para empezar.</p>}
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-5 gap-y-6">
          {projects?.map((p) => (
            <ProjectTile key={p.id} project={p} onChanged={() => void load()} onError={setError} />
          ))}
        </ul>
      </section>

      {status?.version && (
        <footer className="mt-auto text-xs text-faint">
          Versión del {new Date(status.version.date).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' })} · {status.version.commit}
        </footer>
      )}
    </main>
  );
}
