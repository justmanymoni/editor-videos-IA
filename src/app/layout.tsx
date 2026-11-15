import type { Metadata } from 'next';
import './globals.css';
import { SUBTITLE_FONTS, cssFamily } from '@/lib/shared/fonts';

/** Text fonts: the browser uses the same TTF files that FFmpeg/libass uses on export. */
const FONT_FACES = SUBTITLE_FONTS.map(
  (f) => `@font-face{font-family:"${cssFamily(f)}";src:url("/fonts/${f.file}") format("truetype");font-display:block}`,
).join('');

export const metadata: Metadata = {
  title: 'Verticut · editor vertical',
  description: 'Editor de vídeo vertical 9:16 basado en transcripción',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <style dangerouslySetInnerHTML={{ __html: FONT_FACES }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
