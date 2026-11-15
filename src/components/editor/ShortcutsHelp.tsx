'use client';
import { Kbd, Modal } from '@/components/ui';

const ROWS: [string, string][] = [
  ['Espacio', 'Reproducir / pausar'],
  ['S', 'Dividir en el cursor (el elemento seleccionado o el clip principal)'],
  ['G', 'Poner (o quitar) los subtítulos automáticos en todo el vídeo'],
  ['Q', 'Borrar lo que queda a la izquierda del cursor'],
  ['W', 'Borrar lo que queda a la derecha del cursor'],
  ['Supr / Retroceso', 'Eliminar la selección (palabras, clip, texto, superposición, audio, subtítulo)'],
  ['Arrastrar en un hueco', 'Seleccionar varios elementos de la línea de tiempo con un recuadro'],
  ['Ctrl + clic / Shift + clic', 'Añadir o quitar un elemento de la selección'],
  ['Ctrl + A', 'Seleccionar todo'],
  ['Ctrl + Z', 'Deshacer'],
  ['Ctrl + Shift + Z / Ctrl + Y', 'Rehacer'],
  ['← / →', 'Fotograma anterior / siguiente'],
  ['Shift + ← / →', 'Un segundo atrás / adelante'],
  ['Inicio / Fin', 'Ir al principio / final'],
  ['Ctrl + S', 'Guardar ahora'],
  ['Esc', 'Quitar la selección'],
];

export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Atajos de teclado">
      <table className="w-full text-sm">
        <tbody>
          {ROWS.map(([k, v]) => (
            <tr key={k} className="border-b border-line last:border-0">
              <td className="py-2 pr-4 whitespace-nowrap">
                <Kbd>{k}</Kbd>
              </td>
              <td className="py-2 text-muted">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-xs text-faint">
        En la transcripción: haz clic en una palabra para saltar a ese punto, arrastra o usa Shift + clic para seleccionar, doble clic para corregir
        el texto.
      </p>
    </Modal>
  );
}
