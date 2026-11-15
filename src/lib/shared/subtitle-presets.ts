/**
 * Quick styles of the automatic subtitles. Each one only overrides some
 * fields of the default style. Shared by the editor (style panel) and by the
 * server, which applies the one chosen in the settings to new projects.
 */
import type { SubtitleStyle } from './types';
import { DEFAULT_SUBTITLE_STYLE } from './types';

export interface SubtitlePreset {
  id: string;
  name: string;
  style: Partial<SubtitleStyle>;
}

export const SUBTITLE_PRESETS: SubtitlePreset[] = [
  { id: 'amarillo', name: 'Amarillo', style: {} },
  {
    id: 'limpio',
    name: 'Limpio',
    style: {
      fontId: 'montserrat-bold',
      fontSize: 68,
      outlineWidth: 4,
      shadow: 2,
      uppercase: false,
      highlight: false,
      wordsPerPage: 4,
      maxCharsPerLine: 20,
    },
  },
  {
    id: 'clasico',
    name: 'Clásico',
    style: {
      fontId: 'playfair-italic',
      fontSize: 78,
      outlineWidth: 3,
      shadow: 3,
      uppercase: false,
      highlight: false,
      wordsPerPage: 5,
      maxCharsPerLine: 24,
    },
  },
  { id: 'titular', name: 'Titular', style: { fontId: 'anton', fontSize: 110, outlineWidth: 5, shadow: 0, maxCharsPerLine: 14 } },
  {
    id: 'pop',
    name: 'Pop',
    style: { fontId: 'luckiest-guy', fontSize: 96, outlineWidth: 7, shadow: 6, wordsPerPage: 2, activeScale: 1.12, animationIn: 'pop' },
  },
  { id: 'una-palabra', name: 'Una palabra', style: { fontSize: 120, wordsPerPage: 1, outlineWidth: 8, shadow: 5, animationIn: 'zoom' } },
  {
    id: 'caja',
    name: 'Caja',
    style: {
      fontId: 'montserrat-bold',
      fontSize: 66,
      outlineWidth: 0,
      shadow: 3,
      uppercase: false,
      highlightBox: true,
      highlightColor: '#FF6B35',
      boxTextColor: '#111111',
      dimUpcoming: true,
      wordsPerPage: 4,
      maxCharsPerLine: 22,
      animationIn: 'fade',
    },
  },
  {
    id: 'karaoke',
    name: 'Karaoke',
    style: {
      fontId: 'poppins-extrabold',
      fontSize: 78,
      outlineWidth: 5,
      shadow: 3,
      dimUpcoming: true,
      highlightColor: '#3DFF8B',
      wordsPerPage: 4,
      maxCharsPerLine: 18,
    },
  },
  {
    id: 'caja-amarilla',
    name: 'Caja amarilla',
    style: {
      fontId: 'anton',
      fontSize: 104,
      outlineWidth: 5,
      shadow: 0,
      highlightBox: true,
      highlightColor: '#FFE600',
      boxTextColor: '#000000',
      wordsPerPage: 2,
      animationIn: 'pop',
    },
  },
];

/** Complete style of a preset; the default one when the id is unknown. */
export function presetStyle(id: string | undefined): SubtitleStyle {
  const preset = SUBTITLE_PRESETS.find((p) => p.id === id);
  return { ...DEFAULT_SUBTITLE_STYLE, ...(preset?.style ?? {}) };
}
