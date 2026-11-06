/** "1:05.3" style time for the editor UI. */
export function formatTime(t: number, precise = true): string {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  const whole = Math.floor(sec);
  const base = `${m}:${String(whole).padStart(2, '0')}`;
  return precise ? `${base}.${Math.floor((sec - whole) * 10)}` : base;
}

/** "1,4 s" (Spanish decimal comma). */
export const formatSeconds = (s: number, digits = 1) => `${s.toFixed(digits).replace('.', ',')} s`;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Stable colour per media id for timeline blocks. */
export function mediaHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}
