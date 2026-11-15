'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Check, ChevronDown, Search } from 'lucide-react';
import { FONT_GROUPS, cssFamily, getFont, searchFonts, type SubtitleFont } from '@/lib/shared/fonts';

const family = (f: SubtitleFont) => `"${cssFamily(f)}"`;

/**
 * Font list with a search box. Fonts are grouped by style (bold, regular,
 * italic, classic…) and each name is drawn in its own font.
 */
export function FontPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const current = getFont(value);
  const found = useMemo(() => searchFonts(query), [query]);
  // In the order they are shown: group after group.
  const ordered = useMemo(() => FONT_GROUPS.flatMap((g) => found.filter((f) => f.group === g)), [found]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const choose = (id: string) => {
    onChange(id);
    close();
    button.current?.focus();
  };

  // The list floats over the panels: place it under the button, or above when there is more room there.
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const width = Math.max(r.width, 250);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    if (below >= 260 || below >= above) setPlace({ left, width, top: r.bottom + 4, maxHeight: Math.min(420, below) });
    else setPlace({ left, width, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(420, above) });
    setActive(
      Math.max(
        0,
        ordered.findIndex((f) => f.id === value),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) close();
    };
    // The list is fixed on screen: close it only if its button moves away (its panel was scrolled).
    const origin = button.current?.getBoundingClientRect();
    const away = () => {
      const now = button.current?.getBoundingClientRect();
      if (!origin || !now || Math.abs(now.top - origin.top) > 2 || Math.abs(now.left - origin.left) > 2) close();
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', away, true);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', away, true);
    };
  }, [open]);

  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open, place]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (ordered.length) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + ordered.length) % ordered.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (ordered[active]) choose(ordered[active].id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      button.current?.focus();
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded bg-panel-3 px-2 text-left text-xs text-fg outline-none hover:bg-panel-3/80 focus-visible:ring-1 focus-visible:ring-accent"
        aria-label="Fuente"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1 truncate" style={{ fontFamily: family(current) }}>
          {current.label}
        </span>
        <ChevronDown size={13} className="shrink-0 text-muted" />
      </button>
      {open &&
        place &&
        createPortal(
          <div
            ref={panel}
            data-font-list
            className="fixed z-50 flex flex-col overflow-hidden rounded-md border border-line-strong bg-panel-2 shadow-2xl"
            style={place}
            onKeyDown={onKeyDown}
          >
            <label className="flex shrink-0 items-center gap-2 border-b border-line px-2.5 py-2">
              <Search size={13} className="shrink-0 text-muted" />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                placeholder="Buscar fuente…"
                className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-faint"
                aria-label="Buscar fuente"
              />
            </label>
            <div ref={list} role="listbox" className="min-h-0 flex-1 overflow-y-auto py-1">
              {!ordered.length && <p className="px-3 py-4 text-center text-xs text-faint">Ninguna fuente coincide con «{query}»</p>}
              {FONT_GROUPS.map((group) => {
                const fonts = found.filter((f) => f.group === group);
                if (!fonts.length) return null;
                return (
                  <div key={group}>
                    <p className="px-2.5 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-faint uppercase">{group}</p>
                    {fonts.map((f) => {
                      const index = ordered.indexOf(f);
                      return (
                        <button
                          key={f.id}
                          type="button"
                          role="option"
                          aria-selected={f.id === value}
                          data-active={index === active}
                          onPointerMove={() => setActive(index)}
                          onClick={() => choose(f.id)}
                          className={clsx(
                            'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[15px] leading-tight text-fg',
                            index === active && 'bg-panel-3',
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate" style={{ fontFamily: family(f) }}>
                            {f.label}
                          </span>
                          {f.id === value && <Check size={13} className="shrink-0 text-accent" />}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
