import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Verticut · editor vertical',
  description: 'Editor de vídeo vertical 9:16 basado en transcripción',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
