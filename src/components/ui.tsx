'use client';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useEditor } from '@/lib/client/store';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      {...props}
      onMouseUp={(e) => {
        // Keep keyboard shortcuts (space) working after clicking.
        e.currentTarget.blur();
        props.onMouseUp?.(e);
      }}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'h-6 px-2 text-[11px]' : 'h-7 px-3 text-xs',
        variant === 'primary' && 'bg-accent text-black hover:bg-accent-strong',
        variant === 'secondary' && 'bg-panel-3 text-fg hover:bg-line-strong',
        variant === 'ghost' && 'text-muted hover:bg-panel-3 hover:text-fg',
        variant === 'danger' && 'border border-danger/40 text-danger hover:bg-danger/10',
        className,
      )}
    />
  );
}

export function IconButton({ label, active, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      {...props}
      title={label}
      aria-label={label}
      onMouseUp={(e) => e.currentTarget.blur()}
      className={clsx(
        'inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-30',
        active ? 'bg-accent text-black' : 'text-muted hover:bg-panel-3 hover:text-fg',
        className,
      )}
    />
  );
}

export function ProgressBar({ value, indeterminate, className }: { value?: number; indeterminate?: boolean; className?: string }) {
  return (
    <div className={clsx('relative h-1.5 overflow-hidden rounded-full bg-panel-3', className)}>
      {indeterminate ? (
        <div className="animate-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-accent" />
      ) : (
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />
      )}
    </div>
  );
}

export function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  const dismiss = useEditor((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={clsx(
            'pointer-events-auto flex items-start gap-3 rounded-lg border px-3.5 py-2.5 text-sm shadow-2xl shadow-black/50',
            t.kind === 'error' && 'border-danger/40 bg-[#2a1416] text-[#ffd6d6]',
            t.kind === 'success' && 'border-accent/30 bg-[#1f1d0c] text-fg',
            t.kind === 'info' && 'border-line-strong bg-panel-2 text-fg',
          )}
        >
          <span className="flex-1 leading-snug">{t.message}</span>
          <button onClick={() => dismiss(t.id)} className="text-muted hover:text-fg" aria-label="Cerrar">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  // A div, not a <label>: some fields hold several buttons and a label would forward clicks to the first one.
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between text-xs font-medium text-muted">
        {label}
        {hint && <span className="font-normal text-faint tabular-nums">{hint}</span>}
      </span>
      {children}
    </div>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      className="w-full min-w-0"
      style={{ '--fill': `${Math.max(0, Math.min(100, fill))}%` } as React.CSSProperties}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      // After dragging with the mouse the keyboard goes back to the editor (space plays, arrows step frames).
      onPointerUp={(e) => e.currentTarget.blur()}
    />
  );
}

/** One setting per line, CapCut style: name, thin slider and a small number box. */
export function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  scale = 1,
  unit = '',
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  /** Factor between the stored value and the number shown (100 for percentages). */
  scale?: number;
  unit?: string;
}) {
  const shown = Math.round(value * scale * 100) / 100;
  return (
    <div className="flex h-7 items-center gap-2.5">
      <span className="w-[92px] shrink-0 truncate text-xs text-muted" title={label}>
        {label}
      </span>
      <Slider value={value} min={min} max={max} step={step} onChange={onChange} />
      <label className="flex h-6 w-[58px] shrink-0 items-center rounded bg-panel-3 px-1.5 text-[11px] text-fg">
        <input
          type="number"
          value={shown}
          step={step * scale}
          onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange(Math.max(min, Math.min(max, e.target.valueAsNumber / scale)))}
          className="w-full min-w-0 bg-transparent text-right tabular-nums outline-none"
          aria-label={label}
        />
        {unit && <span className="pl-0.5 text-faint">{unit}</span>}
      </label>
    </div>
  );
}

/** A named setting with any control at the right. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center gap-2.5">
      <span className="w-[92px] shrink-0 truncate text-xs text-muted" title={label}>
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  );
}

/** Titled block of settings inside a panel. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-b border-line px-3.5 py-3 last:border-0">
      <h3 className="text-xs font-semibold text-fg">{title}</h3>
      {children}
    </section>
  );
}

export function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex h-6 cursor-pointer items-center gap-1.5 rounded bg-panel-3 px-1.5">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="h-4 w-5 cursor-pointer rounded-sm border-0 bg-transparent p-0"
      />
      <span className="font-mono text-[10px] text-muted uppercase">{value}</span>
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      onMouseUp={(e) => e.currentTarget.blur()}
      className="flex min-h-7 w-full items-center justify-between gap-3 text-left text-xs text-fg"
    >
      <span>{label}</span>
      <span className={clsx('relative h-4 w-7 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line-strong')}>
        <span className={clsx('absolute top-0.5 h-3 w-3 rounded-full transition-all', checked ? 'left-[14px] bg-black' : 'left-0.5 bg-fg')} />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex w-full rounded bg-panel-3 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          onMouseUp={(e) => e.currentTarget.blur()}
          className={clsx(
            'flex-1 rounded-sm px-1.5 py-1 text-[11px] font-medium whitespace-nowrap transition-colors',
            value === o.value ? 'bg-line-strong text-fg' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-label={title} className={clsx('w-full rounded-xl border border-line-strong bg-panel shadow-2xl', width)}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          <IconButton label="Cerrar" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-panel-3 px-1.5 py-0.5 font-mono text-[11px] text-fg">{children}</kbd>;
}
