'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FileUp, Plus, Trash2 } from 'lucide-react';
import type { ProjectDoc, ProjectSummary, ServerStatus } from '@/lib/shared/types';
import { api } from '@/lib/client/api';
import { Button, IconButton } from '@/components/ui';

export function ProjectList() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
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
    try {
      const p = await api.createProject(name.trim() || doc?.name || 'Proyecto sin título', doc);
      router.push(`/editor/${p.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-14">
      <header className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-xl font-black text-black">V</span>
        <div>
          <h1 className="text-2xl font-black tracking-tight">VERTICUT</h1>
          <p className="text-sm text-muted">Edita vídeos verticales 9:16 desde la transcripción</p>
        </div>
      </header>

      {status && status.transcriber === 'none' && (
        <div className="rounded-lg border border-danger/40 bg-danger/5 p-4 text-sm">
          <p className="font-semibold text-danger">No hay transcriptor configurado</p>
          <p className="mt-1 text-muted">
            {status.transcriberDetail}. Añade <code className="text-fg">OPENAI_API_KEY</code> en <code className="text-fg">.env.local</code> o instala
            whisper.cpp (ver README). Puedes editar igualmente: el quitado de silencios funciona con el análisis del audio.
          </p>
        </div>
      )}
      {status && !status.ffmpeg && (
        <div className="rounded-lg border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
          No se encuentra FFmpeg. Instálalo y reinicia el servidor.
        </div>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del nuevo proyecto"
          className="h-10 flex-1 rounded-md border border-line-strong bg-panel-2 px-3 text-sm focus:border-accent focus:outline-none"
        />
        <Button variant="primary" type="submit" className="h-10">
          <Plus size={16} /> Nuevo proyecto
        </Button>
        <Button type="button" className="h-10" onClick={() => fileRef.current?.click()} title="Crear a partir de un JSON exportado">
          <FileUp size={16} /> Importar JSON
        </Button>
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
      </form>
      {error && <p className="text-sm text-danger">{error}</p>}

      <section>
        <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">Proyectos</h2>
        {projects === null && <p className="text-sm text-faint">Cargando…</p>}
        {projects?.length === 0 && <p className="text-sm text-faint">Todavía no hay proyectos. Crea uno para empezar.</p>}
        <ul className="flex flex-col gap-2">
          {projects?.map((p) => (
            <li key={p.id} className="group flex items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3 hover:border-line-strong">
              <Link href={`/editor/${p.id}`} className="min-w-0 flex-1">
                <p className="truncate font-medium group-hover:text-accent">{p.name}</p>
                <p className="text-xs text-faint">
                  {p.clipCount} {p.clipCount === 1 ? 'clip' : 'clips'} · editado{' '}
                  {new Date(p.updatedAt).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              </Link>
              <IconButton
                label="Borrar proyecto"
                onClick={async () => {
                  if (!confirm(`¿Borrar "${p.name}"? Los clips subidos se conservan en storage/.`)) return;
                  await api.deleteProject(p.id);
                  void load();
                }}
              >
                <Trash2 size={15} />
              </IconButton>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
