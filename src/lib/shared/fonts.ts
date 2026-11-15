/**
 * Subtitle fonts. The same TTF file is used by the browser preview (via
 * @font-face) and by FFmpeg/libass on export, so both renders match.
 * Metrics come from `node scripts/font-info.mjs` (kept in sync by a test).
 */
import { normalizeSearch } from './text';

export interface SubtitleFont {
  id: string;
  label: string;
  /** Section of the font picker. */
  group: string;
  file: string;
  /** Family name libass matches (OpenType nameID 1). */
  assFamily: string;
  /** The file is the bold / italic face of its family (libass must ask for it). */
  bold?: boolean;
  italic?: boolean;
  unitsPerEm: number;
  winAscent: number;
  winDescent: number;
}

export const SUBTITLE_FONTS: SubtitleFont[] = [
  {
    id: 'montserrat-black',
    label: 'Montserrat Black',
    group: 'Negrita',
    file: 'montserrat-black.ttf',
    assFamily: 'Montserrat Black',
    unitsPerEm: 1000,
    winAscent: 1109,
    winDescent: 453,
  },
  {
    id: 'montserrat-extrabold',
    label: 'Montserrat ExtraBold',
    group: 'Negrita',
    file: 'montserrat-extrabold.ttf',
    assFamily: 'Montserrat ExtraBold',
    unitsPerEm: 1000,
    winAscent: 1109,
    winDescent: 453,
  },
  {
    id: 'montserrat-bold',
    label: 'Montserrat Bold',
    group: 'Negrita',
    file: 'montserrat-bold.ttf',
    assFamily: 'Montserrat',
    unitsPerEm: 1000,
    winAscent: 1109,
    winDescent: 453,
    bold: true,
  },
  {
    id: 'poppins-extrabold',
    label: 'Poppins ExtraBold',
    group: 'Negrita',
    file: 'poppins-extrabold.ttf',
    assFamily: 'Poppins ExtraBold',
    unitsPerEm: 1000,
    winAscent: 1135,
    winDescent: 627,
  },
  {
    id: 'poppins-bold',
    label: 'Poppins Bold',
    group: 'Negrita',
    file: 'poppins-bold.ttf',
    assFamily: 'Poppins',
    unitsPerEm: 1000,
    winAscent: 1135,
    winDescent: 627,
    bold: true,
  },
  {
    id: 'inter-extrabold',
    label: 'Inter ExtraBold',
    group: 'Negrita',
    file: 'inter-extrabold.ttf',
    assFamily: 'Inter ExtraBold',
    unitsPerEm: 2048,
    winAscent: 2269,
    winDescent: 660,
  },
  {
    id: 'inter-bold',
    label: 'Inter Bold',
    group: 'Negrita',
    file: 'inter-bold.ttf',
    assFamily: 'Inter',
    unitsPerEm: 2048,
    winAscent: 2269,
    winDescent: 660,
    bold: true,
  },
  {
    id: 'archivo-black',
    label: 'Archivo Black',
    group: 'Negrita',
    file: 'archivo-black.ttf',
    assFamily: 'Archivo Black',
    unitsPerEm: 1000,
    winAscent: 1035,
    winDescent: 312,
  },
  {
    id: 'archivo-bold',
    label: 'Archivo Bold',
    group: 'Negrita',
    file: 'archivo-bold.ttf',
    assFamily: 'Archivo',
    unitsPerEm: 1000,
    winAscent: 1100,
    winDescent: 410,
    bold: true,
  },
  {
    id: 'arimo-bold',
    label: 'Arial Bold (Arimo)',
    group: 'Negrita',
    file: 'arimo-bold.ttf',
    assFamily: 'Arimo',
    unitsPerEm: 2048,
    winAscent: 2136,
    winDescent: 797,
    bold: true,
  },
  {
    id: 'roboto-bold',
    label: 'Roboto Bold',
    group: 'Negrita',
    file: 'roboto-bold.ttf',
    assFamily: 'Roboto',
    unitsPerEm: 2048,
    winAscent: 1946,
    winDescent: 512,
    bold: true,
  },
  { id: 'anton', label: 'Anton', group: 'Negrita', file: 'anton.ttf', assFamily: 'Anton', unitsPerEm: 2048, winAscent: 2876, winDescent: 674 },
  {
    id: 'bebas-neue',
    label: 'Bebas Neue',
    group: 'Negrita',
    file: 'bebas-neue.ttf',
    assFamily: 'Bebas Neue',
    unitsPerEm: 1000,
    winAscent: 950,
    winDescent: 350,
  },
  {
    id: 'oswald-semibold',
    label: 'Oswald',
    group: 'Negrita',
    file: 'oswald-semibold.ttf',
    assFamily: 'Oswald SemiBold',
    unitsPerEm: 1000,
    winAscent: 1325,
    winDescent: 377,
  },
  {
    id: 'montserrat-regular',
    label: 'Montserrat',
    group: 'Normal',
    file: 'montserrat-regular.ttf',
    assFamily: 'Montserrat',
    unitsPerEm: 1000,
    winAscent: 1109,
    winDescent: 453,
  },
  {
    id: 'poppins-regular',
    label: 'Poppins',
    group: 'Normal',
    file: 'poppins-regular.ttf',
    assFamily: 'Poppins',
    unitsPerEm: 1000,
    winAscent: 1135,
    winDescent: 627,
  },
  {
    id: 'inter-regular',
    label: 'Inter',
    group: 'Normal',
    file: 'inter-regular.ttf',
    assFamily: 'Inter',
    unitsPerEm: 2048,
    winAscent: 2269,
    winDescent: 660,
  },
  {
    id: 'archivo-regular',
    label: 'Archivo',
    group: 'Normal',
    file: 'archivo-regular.ttf',
    assFamily: 'Archivo',
    unitsPerEm: 1000,
    winAscent: 1100,
    winDescent: 410,
  },
  {
    id: 'arimo-regular',
    label: 'Arial (Arimo)',
    group: 'Normal',
    file: 'arimo-regular.ttf',
    assFamily: 'Arimo',
    unitsPerEm: 2048,
    winAscent: 2136,
    winDescent: 797,
  },
  {
    id: 'roboto-regular',
    label: 'Roboto',
    group: 'Normal',
    file: 'roboto-regular.ttf',
    assFamily: 'Roboto',
    unitsPerEm: 2048,
    winAscent: 1946,
    winDescent: 512,
  },
  {
    id: 'open-sans-regular',
    label: 'Open Sans',
    group: 'Normal',
    file: 'open-sans-regular.ttf',
    assFamily: 'Open Sans',
    unitsPerEm: 2048,
    winAscent: 2302,
    winDescent: 651,
  },
  {
    id: 'montserrat-italic',
    label: 'Montserrat cursiva',
    group: 'Cursiva',
    file: 'montserrat-italic.ttf',
    assFamily: 'Montserrat',
    unitsPerEm: 1000,
    winAscent: 1109,
    winDescent: 453,
    italic: true,
  },
  {
    id: 'poppins-italic',
    label: 'Poppins cursiva',
    group: 'Cursiva',
    file: 'poppins-italic.ttf',
    assFamily: 'Poppins',
    unitsPerEm: 1000,
    winAscent: 1135,
    winDescent: 627,
    italic: true,
  },
  {
    id: 'inter-italic',
    label: 'Inter cursiva',
    group: 'Cursiva',
    file: 'inter-italic.ttf',
    assFamily: 'Inter',
    unitsPerEm: 2048,
    winAscent: 2269,
    winDescent: 660,
    italic: true,
  },
  {
    id: 'arimo-italic',
    label: 'Arial cursiva (Arimo)',
    group: 'Cursiva',
    file: 'arimo-italic.ttf',
    assFamily: 'Arimo',
    unitsPerEm: 2048,
    winAscent: 2136,
    winDescent: 797,
    italic: true,
  },
  {
    id: 'playfair-italic',
    label: 'Playfair cursiva',
    group: 'Cursiva',
    file: 'playfair-italic.ttf',
    assFamily: 'Playfair Display',
    unitsPerEm: 1000,
    winAscent: 1159,
    winDescent: 251,
    italic: true,
  },
  {
    id: 'lora-italic',
    label: 'Lora cursiva',
    group: 'Cursiva',
    file: 'lora-italic.ttf',
    assFamily: 'Lora',
    unitsPerEm: 1000,
    winAscent: 1206,
    winDescent: 294,
    italic: true,
  },
  {
    id: 'playfair-regular',
    label: 'Playfair Display',
    group: 'Clásica',
    file: 'playfair-regular.ttf',
    assFamily: 'Playfair Display',
    unitsPerEm: 1000,
    winAscent: 1159,
    winDescent: 251,
  },
  {
    id: 'tinos-regular',
    label: 'Times (Tinos)',
    group: 'Clásica',
    file: 'tinos-regular.ttf',
    assFamily: 'Tinos',
    unitsPerEm: 2048,
    winAscent: 1825,
    winDescent: 443,
  },
  {
    id: 'courier-prime',
    label: 'Courier Prime',
    group: 'Clásica',
    file: 'courier-prime.ttf',
    assFamily: 'Courier Prime',
    unitsPerEm: 2048,
    winAscent: 1900,
    winDescent: 800,
  },
  {
    id: 'pacifico',
    label: 'Pacifico',
    group: 'Manuscrita',
    file: 'pacifico.ttf',
    assFamily: 'Pacifico',
    unitsPerEm: 1000,
    winAscent: 1478,
    winDescent: 457,
  },
  {
    id: 'dancing-script-bold',
    label: 'Dancing Script',
    group: 'Manuscrita',
    file: 'dancing-script-bold.ttf',
    assFamily: 'Dancing Script',
    unitsPerEm: 1000,
    winAscent: 1096,
    winDescent: 306,
    bold: true,
  },
  {
    id: 'lobster',
    label: 'Lobster',
    group: 'Manuscrita',
    file: 'lobster.ttf',
    assFamily: 'Lobster',
    unitsPerEm: 1000,
    winAscent: 1000,
    winDescent: 490,
  },
  {
    id: 'permanent-marker',
    label: 'Permanent Marker',
    group: 'Manuscrita',
    file: 'permanent-marker.ttf',
    assFamily: 'Permanent Marker',
    unitsPerEm: 1024,
    winAscent: 1136,
    winDescent: 325,
  },
  {
    id: 'luckiest-guy',
    label: 'Luckiest Guy',
    group: 'Divertida',
    file: 'luckiest-guy.ttf',
    assFamily: 'Luckiest Guy',
    unitsPerEm: 2048,
    winAscent: 2006,
    winDescent: 504,
  },
  {
    id: 'bangers',
    label: 'Bangers',
    group: 'Divertida',
    file: 'bangers.ttf',
    assFamily: 'Bangers',
    unitsPerEm: 1000,
    winAscent: 1401,
    winDescent: 356,
  },
  {
    id: 'comic-neue-bold',
    label: 'Comic Neue',
    group: 'Divertida',
    file: 'comic-neue-bold.ttf',
    assFamily: 'Comic Neue',
    unitsPerEm: 1000,
    winAscent: 1000,
    winDescent: 350,
    bold: true,
  },
];

/** Groups shown in the font picker, in order. */
export const FONT_GROUPS = ['Negrita', 'Normal', 'Cursiva', 'Clásica', 'Manuscrita', 'Divertida'] as const;

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

/** Fonts whose name or style contains every word typed in a search box (accents and case are ignored). */
export function searchFonts(query: string): SubtitleFont[] {
  const words = normalizeSearch(query).split(' ').filter(Boolean);
  if (!words.length) return SUBTITLE_FONTS;
  return SUBTITLE_FONTS.filter((f) => {
    const haystack = normalizeSearch(`${f.label} ${f.group}`);
    return words.every((w) => haystack.includes(w));
  });
}

const WEIGHT_SUFFIX = /-(regular|bold|extrabold|semibold|black|italic)$/;
const BOLD_SUFFIX = /-(bold|extrabold|semibold|black)$/;
/** Fonts of the same family share what comes before the weight: "montserrat-bold" → "montserrat". */
export const fontFamilyKey = (id: string) => id.replace(WEIGHT_SUFFIX, '');
export const isBoldFont = (font: SubtitleFont) => !!font.bold || BOLD_SUFFIX.test(font.id);

/**
 * The font of the same family with bold or italic switched on or off (the
 * "B" and "I" buttons), or null when the catalogue has no such variant.
 */
export function fontVariant(id: string, change: { bold?: boolean; italic?: boolean }): string | null {
  const current = getFont(id);
  const family = SUBTITLE_FONTS.filter((f) => fontFamilyKey(f.id) === fontFamilyKey(id));
  const bold = change.bold ?? (change.italic ? false : isBoldFont(current));
  const italic = change.italic ?? false;
  // "-bold" before the heavier weights, so B gives the normal bold.
  const order = (f: SubtitleFont) => (f.id.endsWith('-bold') ? 0 : 1);
  const match = family.filter((f) => isBoldFont(f) === bold && !!f.italic === italic).sort((a, b) => order(a) - order(b))[0];
  return match && match.id !== id ? match.id : null;
}

/** Fonts by name, as a font menu lists them (families end up together: Montserrat, Montserrat Black, Montserrat Bold…). */
export const fontsByName = (fonts: SubtitleFont[]) => [...fonts].sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
