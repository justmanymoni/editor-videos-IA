'use client';
import { useEffect, useState } from 'react';
import type { AppSettings, ServerStatus } from '@/lib/shared/types';
import { SUBTITLE_PRESETS } from '@/lib/shared/subtitle-presets';
import { api } from '@/lib/client/api';
import { useLayout } from '@/lib/client/layout';
import { Button, Modal, Row, Section, Segmented, SliderRow, Toggle } from '@/components/ui';
import { LocalTranscription } from '@/components/LocalTranscription';

export const LANGUAGES: [string, string][] = [
  ['es', 'Español'],
  ['en', 'Inglés'],
  ['pt', 'Portugués'],
  ['fr', 'Francés'],
  ['it', 'Italiano'],
  ['de', 'Alemán'],
  ['ca', 'Catalán'],
  ['auto', 'Detectar'],
];

const selectClass = 'h-7 min-w-0 flex-1 rounded bg-panel-3 px-2 text-xs text-fg outline-none';

/**
 * General settings of the app, the same from the home screen and from the
 * editor: the transcription model, what new projects start with, the export
 * quality and the layout of the editor.
 */
export function SettingsDialog({
  open,
  onClose,
  status,
  onStatus,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  status: ServerStatus | null;
  /** The transcription engine or model changed. */
  onStatus: (status: ServerStatus) => void;
  onSaved?: (settings: AppSettings) => void;
}) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useLayout();

  useEffect(() => {
    if (!open) return;
    setError(null);
    api
      .settings()
      .then(setSettings)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [open]);

  /** Shows the change at once and saves it. */
  const save = (patch: Partial<AppSettings>) => {
    if (!settings) return;
    setSettings({ ...settings, ...patch });
    api
      .saveSettings(patch)
      .then((saved) => {
        setSettings(saved);
        onSaved?.(saved);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <Modal open={open} onClose={onClose} title="Ajustes" width="max-w-2xl">
      <div data-settings className="-mx-1 flex max-h-[72vh] flex-col overflow-y-auto text-sm">
        {error && <p className="px-3.5 pb-2 text-xs text-danger">{error}</p>}

        <Section title="Transcripción de voz a texto">
          <LocalTranscription status={status} onInstalled={onStatus} />
          {settings && (
            <Row label="Idioma">
              <select
                value={settings.language}
                onChange={(e) => save({ language: e.target.value })}
                className={selectClass}
                aria-label="Idioma por defecto"
              >
                {LANGUAGES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Row>
          )}
          <p className="text-[11px] leading-relaxed text-faint">
            Es el idioma con el que empiezan los proyectos nuevos; en cada proyecto se puede cambiar en la pestaña Transcripción.
          </p>
        </Section>

        {settings && (
          <>
            <Section title="Proyectos nuevos">
              <Toggle
                label="Quitar los silencios automáticamente al añadir clips"
                checked={settings.autoSilence}
                onChange={(v) => save({ autoSilence: v })}
              />
              <SliderRow
                label="Silencio mínimo"
                value={settings.silenceMin}
                min={0.2}
                max={2}
                step={0.05}
                unit="s"
                onChange={(v) => save({ silenceMin: v })}
              />
              <Row label="Subtítulos">
                <select
                  value={settings.subtitlePreset}
                  onChange={(e) => save({ subtitlePreset: e.target.value })}
                  className={selectClass}
                  aria-label="Estilo de subtítulos por defecto"
                >
                  {SUBTITLE_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="Clips horizontales">
                <Segmented
                  value={settings.fitMode}
                  onChange={(v) => save({ fitMode: v })}
                  options={[
                    { value: 'cover', label: 'Rellenar' },
                    { value: 'blur', label: 'Fondo borroso' },
                  ]}
                />
              </Row>
              <p className="text-[11px] leading-relaxed text-faint">
                Con esto empieza cada proyecto que crees a partir de ahora. Los proyectos que ya existen no cambian.
              </p>
            </Section>

            <Section title="Exportación">
              <Row label="Calidad">
                <Segmented
                  value={settings.exportQuality}
                  onChange={(v) => save({ exportQuality: v })}
                  options={[
                    { value: 'fast', label: 'Rápida' },
                    { value: 'normal', label: 'Normal' },
                    { value: 'high', label: 'Alta' },
                  ]}
                />
              </Row>
              <p className="text-[11px] leading-relaxed text-faint">
                La calidad que aparece marcada al exportar. Siempre MP4 vertical 1080×1920 a 30 fps.
              </p>
            </Section>
          </>
        )}

        <Section title="Editor">
          <Row label="Reproductor">
            <Segmented
              value={layout.player}
              onChange={(v) => setLayout({ player: v })}
              options={[
                { value: 'center', label: 'En el centro' },
                { value: 'right', label: 'A la derecha' },
              ]}
            />
          </Row>
          <Button size="sm" className="self-start" onClick={() => setLayout({ toolsW: null, sideW: null, playerW: null, timelineH: 300 })}>
            Restablecer el tamaño de los paneles
          </Button>
        </Section>

        {status && (
          <Section title="Acerca de">
            <dl className="grid grid-cols-[92px_1fr] gap-x-2.5 gap-y-1 text-xs">
              <dt className="text-muted">Versión</dt>
              <dd>
                {status.version
                  ? `${new Date(status.version.date).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' })} · ${status.version.commit}`
                  : 'Sin datos'}
              </dd>
              <dt className="text-muted">FFmpeg</dt>
              <dd className={status.ffmpeg && status.ffprobe ? undefined : 'text-danger'}>{status.ffmpeg ?? 'No se encuentra'}</dd>
              <dt className="text-muted">Transcripción</dt>
              <dd>{status.transcriber === 'none' ? 'Sin instalar' : status.transcriberDetail}</dd>
              <dt className="text-muted">Recursos</dt>
              <dd className="font-mono text-[11px] break-all text-muted">{status.resourcesDir}</dd>
            </dl>
          </Section>
        )}
      </div>
    </Modal>
  );
}
