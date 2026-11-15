'use client';
import { FONT_GROUPS, SUBTITLE_FONTS, cssFamily, getFont } from '@/lib/shared/fonts';

/** Font list grouped by style (bold, regular, italic, classic…), shown in the chosen font. */
export function FontPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 min-w-0 flex-1 rounded bg-panel-3 px-2 text-xs text-fg outline-none"
      style={{ fontFamily: `"${cssFamily(getFont(value))}"` }}
      aria-label="Fuente"
    >
      {FONT_GROUPS.map((group) => (
        <optgroup key={group} label={group} style={{ fontFamily: 'var(--font-sans)' }}>
          {SUBTITLE_FONTS.filter((f) => f.group === group).map((f) => (
            <option key={f.id} value={f.id} style={{ fontFamily: 'var(--font-sans)' }}>
              {f.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
