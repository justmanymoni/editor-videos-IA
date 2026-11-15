'use client';
import { Captions, Eraser, Repeat, Scissors, Sparkles } from 'lucide-react';
import { useEditor } from '@/lib/client/store';
import { useSubtitlePages } from '@/lib/client/derived';
import { clearCuts, runCleanup, toggleAutoSubtitles } from '@/lib/client/actions';
import { formatSeconds } from '@/lib/client/format';
import { Button, Kbd, Section, SliderRow } from '@/components/ui';

/** "Inteligente" tab: the things the editor does on its own with one click. */
export function SmartPanel() {
  const doc = useEditor((s) => s.doc)!;
  const commit = useEditor((s) => s.commit);
  const pages = useSubtitlePages();
  const settings = doc.settings;
  const silences = doc.clips.flatMap((c) => c.cuts.filter((x) => x.reason === 'silence'));
  const removed = silences.reduce((sum, x) => sum + (x.end - x.start), 0);
  const subtitled = doc.subtitles.enabled;

  return (
    <div className="h-full overflow-y-auto">
      <Section title="Quitar silencios">
        <p className="text-[11px] leading-relaxed text-muted">
          Corta las pausas en las que te quedas callado, por ejemplo mientras piensas, y deja el resto como está.
        </p>
        <SliderRow
          label="Pausas de más de"
          value={settings.silenceMin}
          min={0.2}
          max={3}
          step={0.1}
          unit="s"
          onChange={(v) => commit((d) => void (d.settings.silenceMin = v), 'silenceMin')}
        />
        <div className="flex flex-wrap gap-2">
          <Button data-smart="silence" variant="primary" size="sm" onClick={() => runCleanup('silence')}>
            <Scissors size={13} /> Quitar silencios
          </Button>
          {silences.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => clearCuts('silence')}>
              Recuperarlos
            </Button>
          )}
        </div>
        {silences.length > 0 && (
          <p className="text-[11px] text-faint">
            Ahora hay {silences.length} {silences.length === 1 ? 'silencio quitado' : 'silencios quitados'} ({formatSeconds(removed)} menos).
          </p>
        )}
      </Section>

      <Section title="Subtítulos automáticos">
        <p className="text-[11px] leading-relaxed text-muted">
          {subtitled
            ? `El vídeo tiene ${pages.length} ${pages.length === 1 ? 'subtítulo' : 'subtítulos'} creados a partir de la voz.`
            : 'Pone subtítulos en todo el vídeo a partir de lo que se dice.'}
        </p>
        <Button data-smart="subtitles" variant={subtitled ? 'secondary' : 'primary'} size="sm" className="self-start" onClick={toggleAutoSubtitles}>
          <Captions size={13} /> {subtitled ? 'Quitar los subtítulos' : 'Añadir subtítulos a todo el vídeo'} <Kbd>G</Kbd>
        </Button>
        {subtitled && (
          <Button size="sm" variant="ghost" className="self-start" onClick={() => useEditor.getState().set({ inspectorTab: 'subtitles' })}>
            <Sparkles size={12} /> Cambiar su estilo
          </Button>
        )}
      </Section>

      <Section title="Más limpieza">
        <div className="flex flex-wrap gap-2">
          <Button data-smart="filler" size="sm" onClick={() => runCleanup('filler')} title={settings.fillers.join(', ')}>
            <Eraser size={13} /> Quitar muletillas
          </Button>
          <Button data-smart="retake" size="sm" onClick={() => runCleanup('retake')} title="Si repites una frase, se queda con la última toma">
            <Repeat size={13} /> Quitar tomas repetidas
          </Button>
        </div>
        <p className="text-[11px] leading-relaxed text-faint">
          Todo se puede deshacer con Ctrl + Z. En la pestaña Transcripción (a la izquierda) ves exactamente qué se ha cortado.
        </p>
      </Section>
    </div>
  );
}
