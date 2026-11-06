/**
 * Subtitle fonts. The same TTF file is used by the browser preview (via
 * @font-face) and by FFmpeg/libass on export, so both renders match.
 * Metrics come from `node scripts/font-info.mjs` (kept in sync by a test).
 */
export interface SubtitleFont {
  id: string;
  label: string;
  file: string;
  /** Family name libass matches (OpenType nameID 1). */
  assFamily: string;
  unitsPerEm: number;
  winAscent: number;
  winDescent: number;
}

export const SUBTITLE_FONTS: SubtitleFont[] = [
  {
    id: 'montserrat-black',
    label: 'Montserrat Black',
    file: 'montserrat-black.ttf',
    assFamily: 'Montserrat Black',
    unitsPerEm: 1000,
    winAscent: 1109,
    winDescent: 453,
  },
  {
    id: 'montserrat-extrabold',
    label: 'Montserrat ExtraBold',
    file: 'montserrat-extrabold.ttf',
    assFamily: 'Montserrat ExtraBold',
    unitsPerEm: 1000,
    winAscent: 1109,
    winDescent: 453,
  },
  {
    id: 'poppins-extrabold',
    label: 'Poppins ExtraBold',
    file: 'poppins-extrabold.ttf',
    assFamily: 'Poppins ExtraBold',
    unitsPerEm: 1000,
    winAscent: 1135,
    winDescent: 627,
  },
  {
    id: 'inter-extrabold',
    label: 'Inter ExtraBold',
    file: 'inter-extrabold.ttf',
    assFamily: 'Inter ExtraBold',
    unitsPerEm: 2048,
    winAscent: 2269,
    winDescent: 660,
  },
  {
    id: 'archivo-black',
    label: 'Archivo Black',
    file: 'archivo-black.ttf',
    assFamily: 'Archivo Black',
    unitsPerEm: 1000,
    winAscent: 1035,
    winDescent: 312,
  },
  { id: 'anton', label: 'Anton', file: 'anton.ttf', assFamily: 'Anton', unitsPerEm: 2048, winAscent: 2876, winDescent: 674 },
  { id: 'bebas-neue', label: 'Bebas Neue', file: 'bebas-neue.ttf', assFamily: 'Bebas Neue', unitsPerEm: 1000, winAscent: 950, winDescent: 350 },
  {
    id: 'luckiest-guy',
    label: 'Luckiest Guy',
    file: 'luckiest-guy.ttf',
    assFamily: 'Luckiest Guy',
    unitsPerEm: 2048,
    winAscent: 2006,
    winDescent: 504,
  },
];

export function getFont(id: string): SubtitleFont {
  return SUBTITLE_FONTS.find((f) => f.id === id) ?? SUBTITLE_FONTS[0];
}

/** CSS family name registered with @font-face for a subtitle font. */
export const cssFamily = (font: SubtitleFont) => `vc-${font.id}`;

/** Line height (as a multiple of the font size) that libass uses for this font. */
export const lineHeightFactor = (font: SubtitleFont) => (font.winAscent + font.winDescent) / font.unitsPerEm;

/**
 * libass scales a font so that winAscent + winDescent equals the ASS Fontsize,
 * whereas CSS font-size is the em size. Converts CSS px → ASS Fontsize.
 */
export const assFontSize = (font: SubtitleFont, cssPx: number) => cssPx * lineHeightFactor(font);
