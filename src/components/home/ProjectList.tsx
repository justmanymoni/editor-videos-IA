'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';
import {
  ArrowLeft,
  Check,
  Clapperboard,
  Copy,
  FileUp,
  Folder as FolderIcon,
  FolderInput,
  FolderPlus,
  Pencil,
  Plus,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import type { Folder, ProjectDoc, ProjectSummary, ServerStatus } from '@/lib/shared/types';
import { api } from '@/lib/client/api';
import { formatUpdated } from '@/lib/client/format';
import { SettingsDialog } from '@/components/SettingsDialog';

/** Projects being dragged onto a folder. */
const DRAG_TYPE = 'application/x-verticut-projects';

/** A free name such as "Nuevo proyecto 3". */
function freeName(base: string, used: string[]) {
  const taken = new Set(used);
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base} ${n}`;
    if (!taken.has(name)) return name;
  }
}

const tileAction = 'flex h-7 w-7 items-center justify-center rounded-md bg-black/70 text-white/90 hover:bg-black hover:text-accent';

function Thumb({ mediaId, className }: { mediaId: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!mediaId || failed) {
    return (
      <span className={clsx('flex items-center justify-center bg-panel-2 text-faint', className)}>
        <Clapperboard size={className?.includes('h-full') ? 34 : 14} strokeWidth={1.4} />
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img src={`/api/media/${mediaId}/thumb`} alt="" draggable={false} onError={() => setFailed(true)} className={clsx('object-cover', className)} />
  );
}

/** Name under a tile, editable in place. */
function TileName({
  name,
  renaming,
  onRename,
  onStart,
}: {
  name: string;
  renaming: boolean;
  onRename: (name: string | null) => void;
  onStart: () => void;
}) {
  if (!renaming) {
    return (
      <p className="truncate text-sm font-medium" title={`${name} (doble clic para cambiar el nombre)`} onDoubleClick={onStart}>
        {name}
      </p>
    );
  }
  return (
    <input
      autoFocus
      defaultValue={name}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => onRename(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') onRename(null);
      }}
      className="w-full rounded border border-accent bg-panel-2 px-1.5 py-0.5 text-sm outline-none"
      aria-label="Nombre"
    />
  );
}

/** One project: a square thumbnail with its name and the time of its last change underneath. */
function ProjectTile({
  project,
  selected,
  picking,
  onToggle,
  onDragIds,
  run,
}: {
  project: ProjectSummary;
  selected: boolean;
  /** Projects are being chosen: a click marks the project instead of opening it. */
  picking: boolean;
  onToggle: () => void;
  /** Ids to move when this tile is dragged (the whole selection when it is part of it). */
  onDragIds: () => string[];
  run: (work: () => Promise<unknown>) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const rename = (name: string | null) => {
    setRenaming(false);
    if (name?.trim() && name.trim() !== project.name) run(() => api.renameProject(project.id, name));
  };
  const duplicate = () => run(async () => api.createProject(`${project.name} (copia)`, await api.project(project.id), project.folderId));
  const remove = () => {
    if (confirm(`¿Borrar "${project.name}"? Los clips subidos se conservan en storage/.`)) run(() => api.deleteProject(project.id));
  };

  return (
    <li
      data-project={project.id}
      data-selected={selected || undefined}
      className="group flex min-w-0 flex-col gap-2"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(onDragIds()));
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <div className="relative">
        <Link
          href={`/editor/${project.id}`}
          onClick={(e) => {
            // While choosing projects (or with Ctrl / Shift) a click marks the project.
            if (picking || e.ctrlKey || e.metaKey || e.shiftKey) {
              e.preventDefault();
              onToggle();
            }
          }}
          className={clsx(
            'block aspect-square overflow-hidden rounded-xl bg-panel-2 transition',
            selected ? 'ring-2 ring-accent' : 'ring-1 ring-line group-hover:ring-2 group-hover:ring-accent',
          )}
          title={picking ? project.name : `Abrir ${project.name}`}
        >
          <Thumb mediaId={project.thumbMediaId} className="h-full w-full transition-transform duration-200 group-hover:scale-[1.03]" />
        </Link>
        <button
          role="checkbox"
          aria-checked={selected}
          aria-label={`Seleccionar ${project.name}`}
          onClick={onToggle}
          className={clsx(
            'absolute top-1.5 left-1.5 flex h-6 w-6 items-center justify-center rounded-md border transition-opacity',
            selected ? 'border-accent bg-accent text-black' : 'border-white/70 bg-black/60 text-transparent',
            !selected && !picking && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
          )}
        >
          <Check size={14} strokeWidth={3} />
        </button>
        {!picking && (
          <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <button className={tileAction} onClick={() => setRenaming(true)} title="Cambiar el nombre" aria-label="Cambiar el nombre">
              <Pencil size={13} />
            </button>
            <button className={tileAction} onClick={duplicate} title="Duplicar" aria-label="Duplicar">
              <Copy size={13} />
            </button>
            <button className={`${tileAction} hover:text-danger`} onClick={remove} title="Borrar" aria-label="Borrar">
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>
      <div className="min-w-0 px-0.5">
        <TileName name={project.name} renaming={renaming} onRename={rename} onStart={() => setRenaming(true)} />
        <p className="mt-0.5 text-xs text-faint">{formatUpdated(project.updatedAt)}</p>
      </div>
    </li>
  );
}

/** A folder: a mosaic of what it holds. Projects can be dropped on it. */
function FolderTile({
  folder,
  projects,
  picking,
  onOpen,
  onDropIds,
  run,
}: {
  folder: Folder;
  projects: ProjectSummary[];
  picking: boolean;
  onOpen: () => void;
  onDropIds: (ids: string[]) => void;
  run: (work: () => Promise<unknown>) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [over, setOver] = useState(false);
  const rename = (name: string | null) => {
    setRenaming(false);
    if (name?.trim() && name.trim() !== folder.name) run(() => api.renameFolder(folder.id, name));
  };
  const remove = () => {
    const note = projects.length ? ` Sus ${projects.length} proyectos no se borran: vuelven a la pantalla principal.` : '';
    if (confirm(`¿Quitar la carpeta "${folder.name}"?${note}`)) run(() => api.deleteFolder(folder.id));
  };
  return (
    <li data-folder={folder.id} className="group flex min-w-0 flex-col gap-2">
      <div className="relative">
        <button
          onClick={onOpen}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            setOver(false);
            const raw = e.dataTransfer.getData(DRAG_TYPE);
            if (!raw) return;
            e.preventDefault();
            onDropIds(JSON.parse(raw) as string[]);
          }}
          className={clsx(
            'block aspect-square w-full overflow-hidden rounded-xl bg-panel p-2.5 text-left transition',
            over ? 'ring-2 ring-accent' : 'ring-1 ring-line group-hover:ring-2 group-hover:ring-accent',
          )}
          title={`Abrir la carpeta ${folder.name}`}
        >
          {projects.length ? (
            <span className="grid h-full w-full grid-cols-2 grid-rows-2 gap-1.5">
              {projects.slice(0, 4).map((p) => (
                <Thumb key={p.id} mediaId={p.thumbMediaId} className="h-full min-h-0 w-full rounded-md" />
              ))}
            </span>
          ) : (
            <span className="flex h-full w-full items-center justify-center text-faint">
              <FolderIcon size={40} strokeWidth={1.2} />
            </span>
          )}
        </button>
        {!picking && (
          <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <button className={tileAction} onClick={() => setRenaming(true)} title="Cambiar el nombre" aria-label="Cambiar el nombre de la carpeta">
              <Pencil size={13} />
            </button>
            <button className={`${tileAction} hover:text-danger`} onClick={remove} title="Quitar la carpeta" aria-label="Quitar la carpeta">
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>
      <div className="min-w-0 px-0.5">
        <span className="flex items-center gap-1.5">
          <FolderIcon size={13} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            <TileName name={folder.name} renaming={renaming} onRename={rename} onStart={() => setRenaming(true)} />
          </span>
        </span>
        <p className="mt-0.5 text-xs text-faint">
          {projects.length} {projects.length === 1 ? 'proyecto' : 'proyectos'}
        </p>
      </div>
    </li>
  );
}

const barButton = 'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors';

export function ProjectList() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Folder being looked at; null = the main screen. */
  const [current, setCurrent] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Name of the folder being created while its projects are chosen in the list. */
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () =>
    Promise.all([api.projects(), api.folders()])
      .then(([p, f]) => {
        setProjects(p);
        setFolders(f);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    void load();
    api
      .status()
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  const run = (work: () => Promise<unknown>) => {
    setError(null);
    work()
      .then(load)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  const all = projects ?? [];
  const folder = folders.find((f) => f.id === current) ?? null;
  // A folder that was removed elsewhere: back to the main screen.
  const view = folder ? current : null;
  const shown = all.filter((p) => (folders.some((f) => f.id === p.folderId) ? p.folderId : null) === view);
  const picking = newFolder !== null;
  const clear = () => setSelected(new Set());
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const create = async (doc?: ProjectDoc) => {
    setCreating(true);
    try {
      const p = await api.createProject(
        doc?.name ||
          freeName(
            'Nuevo proyecto',
            all.map((x) => x.name),
          ),
        doc,
        view,
      );
      router.push(`/editor/${p.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCreating(false);
    }
  };

  const move = (ids: string[], folderId: string | null) => {
    if (!ids.length) return;
    clear();
    run(() => api.moveProjects(ids, folderId));
  };
  const createFolder = () => {
    const name = newFolder?.trim();
    if (!name) return;
    const ids = [...selected];
    setNewFolder(null);
    clear();
    run(() => api.createFolder(name, ids));
  };
  const removeSelected = () => {
    const ids = [...selected];
    if (
      !confirm(
        `¿Borrar ${ids.length === 1 ? 'el proyecto seleccionado' : `los ${ids.length} proyectos seleccionados`}? Los clips subidos se conservan en storage/.`,
      )
    )
      return;
    clear();
    run(() => Promise.all(ids.map((id) => api.deleteProject(id))));
  };

  const transcriptionMissing = !!status && status.transcriber === 'none';

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-7 px-8 py-10">
      <header className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-lg font-black text-black">V</span>
        <h1 className="flex-1 text-xl font-black tracking-tight">VERTICUT</h1>
        <button
          data-settings-button
          onClick={() => setSettingsOpen(true)}
          className="relative flex h-9 items-center gap-2 rounded-lg border border-line bg-panel px-3 text-sm text-muted transition hover:border-line-strong hover:text-fg"
          title={transcriptionMissing ? 'Ajustes · falta instalar la transcripción de voz' : 'Ajustes'}
        >
          <Settings size={16} /> Ajustes
          {transcriptionMissing && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-accent" />}
        </button>
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
          <Plus size={22} strokeWidth={2.6} /> Nuevo proyecto{folder ? ` en «${folder.name}»` : ''}
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="flex h-28 w-44 flex-col items-center justify-center gap-1.5 rounded-xl border border-line bg-panel text-sm text-muted transition hover:border-line-strong hover:text-fg"
          title="Crear un proyecto a partir de un archivo .json exportado"
        >
          <FileUp size={20} /> Importar proyecto
        </button>
        <button
          data-new-folder
          onClick={() => {
            setCurrent(null);
            setNewFolder(
              freeName(
                'Carpeta nueva',
                folders.map((f) => f.name),
              ),
            );
          }}
          disabled={picking}
          className="flex h-28 w-44 flex-col items-center justify-center gap-1.5 rounded-xl border border-line bg-panel text-sm text-muted transition hover:border-line-strong hover:text-fg disabled:opacity-50"
          title="Crear una carpeta y elegir qué proyectos van dentro"
        >
          <FolderPlus size={20} /> Nueva carpeta
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

      <section>
        <div className="mb-4 flex min-h-8 flex-wrap items-center gap-2">
          {folder ? (
            <>
              <button
                data-back
                onClick={() => {
                  setCurrent(null);
                  clear();
                }}
                onDragOver={(e) => e.dataTransfer.types.includes(DRAG_TYPE) && e.preventDefault()}
                onDrop={(e) => {
                  const raw = e.dataTransfer.getData(DRAG_TYPE);
                  if (raw) move(JSON.parse(raw) as string[], null);
                }}
                className={`${barButton} -ml-2.5 text-muted hover:bg-panel-3 hover:text-fg`}
                title="Volver a todos los proyectos (suelta aquí un proyecto para sacarlo de la carpeta)"
              >
                <ArrowLeft size={14} /> Proyectos
              </button>
              <span className="text-faint">/</span>
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <FolderIcon size={14} className="text-accent" /> {folder.name} ({shown.length})
              </h2>
            </>
          ) : (
            <h2 className="text-sm font-semibold">Proyectos{all.length ? ` (${all.length})` : ''}</h2>
          )}
        </div>

        {picking && (
          <div data-folder-bar className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-accent/60 bg-accent/5 p-3">
            <FolderPlus size={16} className="shrink-0 text-accent" />
            <input
              autoFocus
              value={newFolder ?? ''}
              onChange={(e) => setNewFolder(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createFolder();
                if (e.key === 'Escape') {
                  setNewFolder(null);
                  clear();
                }
              }}
              placeholder="Nombre de la carpeta"
              className="h-8 w-56 rounded-md border border-line-strong bg-panel-2 px-2.5 text-sm outline-none focus:border-accent"
              aria-label="Nombre de la carpeta"
            />
            <p className="min-w-40 flex-1 text-xs text-muted">
              Marca abajo los proyectos que quieras meter en la carpeta{selected.size ? ` · ${selected.size} marcados` : ''}.
            </p>
            <button
              onClick={createFolder}
              disabled={!newFolder?.trim()}
              className={`${barButton} bg-accent text-black hover:brightness-95 disabled:opacity-50`}
            >
              <Check size={14} strokeWidth={3} /> Crear carpeta{selected.size ? ` con ${selected.size}` : ''}
            </button>
            <button
              onClick={() => {
                setNewFolder(null);
                clear();
              }}
              className={`${barButton} text-muted hover:bg-panel-3 hover:text-fg`}
            >
              Cancelar
            </button>
          </div>
        )}

        {!picking && selected.size > 0 && (
          <div data-selection-bar className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line-strong bg-panel p-3">
            <p className="text-sm font-medium">
              {selected.size} {selected.size === 1 ? 'seleccionado' : 'seleccionados'}
            </p>
            <span className="mx-1 h-5 w-px bg-line" />
            <span className="flex items-center gap-1 text-xs text-muted">
              <FolderInput size={14} /> Mover a:
            </span>
            {folders
              .filter((f) => f.id !== view)
              .map((f) => (
                <button
                  key={f.id}
                  data-move-to={f.id}
                  onClick={() => move([...selected], f.id)}
                  className={`${barButton} bg-panel-3 text-fg hover:text-accent`}
                >
                  <FolderIcon size={13} /> {f.name}
                </button>
              ))}
            <button
              onClick={() =>
                setNewFolder(
                  freeName(
                    'Carpeta nueva',
                    folders.map((f) => f.name),
                  ),
                )
              }
              className={`${barButton} bg-panel-3 text-fg hover:text-accent`}
            >
              <FolderPlus size={13} /> Carpeta nueva
            </button>
            {view && (
              <button data-move-out onClick={() => move([...selected], null)} className={`${barButton} bg-panel-3 text-fg hover:text-accent`}>
                Sacar de la carpeta
              </button>
            )}
            <span className="flex-1" />
            <button onClick={removeSelected} className={`${barButton} text-danger hover:bg-danger/10`}>
              <Trash2 size={13} /> Borrar
            </button>
            <button onClick={clear} className={`${barButton} text-muted hover:bg-panel-3 hover:text-fg`} aria-label="Quitar la selección">
              <X size={14} /> Cancelar
            </button>
          </div>
        )}

        {projects === null && <p className="text-sm text-faint">Cargando…</p>}
        {projects?.length === 0 && !folders.length && (
          <p className="text-sm text-faint">Todavía no hay proyectos. Pulsa «Nuevo proyecto» para empezar.</p>
        )}
        {folder && projects !== null && !shown.length && (
          <p className="text-sm text-faint">Esta carpeta está vacía. Crea aquí un proyecto nuevo, o vuelve atrás y arrastra proyectos sobre ella.</p>
        )}
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-5 gap-y-6">
          {!view &&
            folders.map((f) => (
              <FolderTile
                key={f.id}
                folder={f}
                projects={all.filter((p) => p.folderId === f.id)}
                picking={picking}
                onOpen={() => {
                  if (picking) return;
                  setCurrent(f.id);
                  clear();
                }}
                onDropIds={(ids) => move(ids, f.id)}
                run={run}
              />
            ))}
          {shown.map((p) => (
            <ProjectTile
              key={p.id}
              project={p}
              selected={selected.has(p.id)}
              picking={picking}
              onToggle={() => toggle(p.id)}
              onDragIds={() => (selected.has(p.id) ? [...selected] : [p.id])}
              run={run}
            />
          ))}
        </ul>
      </section>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} status={status} onStatus={setStatus} />
    </main>
  );
}
