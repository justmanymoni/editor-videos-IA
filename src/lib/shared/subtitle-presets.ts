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

/** The look before shadows could be adjusted: thick black outline and a hard shadow. */
const OUTLINED = { fontId: 'montserrat-black', outlineWidth: 6, shadowOn: true, shadow: 6, shadowBlur: 0, shadowOpacity: 0.5 } as const;
/** A hard shadow of the given size, or none. */
const hard = (shadow: number) => ({ shadowOn: shadow > 0, shadow, shadowBlur: 0, shadowOpacity: 0.5 });

export const SUBTITLE_PRESETS: SubtitlePreset[] = [
  // The default: Montserrat without outline, with a soft shadow.
  { id: 'montserrat', name: 'Montserrat', style: {} },
  { id: 'amarillo', name: 'Amarillo', style: { ...OUTLINED } },
  {
    id: 'limpio',
    name: 'Limpio',
    style: {
      fontId: 'montserrat-bold',
      fontSize: 68,
      outlineWidth: 4,
      ...hard(2),
      textCase: 'none',
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
      ...hard(3),
      textCase: 'none',
      highlight: false,
      wordsPerPage: 5,
      maxCharsPerLine: 24,
    },
  },
  { id: 'titular', name: 'Titular', style: { fontId: 'anton', fontSize: 110, outlineWidth: 5, ...hard(0), maxCharsPerLine: 14 } },
  {
    id: 'pop',
    name: 'Pop',
    style: { fontId: 'luckiest-guy', fontSize: 96, outlineWidth: 7, ...hard(6), wordsPerPage: 2, activeScale: 1.12, animationIn: 'pop' },
  },
  {
    id: 'una-palabra',
    name: 'Una palabra',
    style: { fontId: 'montserrat-black', fontSize: 120, wordsPerPage: 1, outlineWidth: 8, ...hard(7), animationIn: 'zoom' },
  },
  {
    id: 'caja',
    name: 'Caja',
    style: {
      fontId: 'montserrat-bold',
      fontSize: 66,
      outlineWidth: 0,
      ...hard(3),
      textCase: 'none',
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
      ...hard(3),
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
      ...hard(0),
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
