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
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
        variant === 'primary' && 'bg-accent text-black hover:bg-accent-strong',
        variant === 'secondary' && 'border border-line-strong bg-panel-2 text-fg hover:bg-panel-3',
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
  return <input type="range" className="w-full" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />;
}

export function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-line-strong bg-panel-2 px-2 py-1">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="h-6 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
      />
      <span className="font-mono text-xs text-muted uppercase">{value}</span>
    </div>
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
      className="flex items-center justify-between gap-3 text-sm text-fg"
    >
      <span>{label}</span>
      <span className={clsx('relative h-5 w-9 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-panel-3')}>
        <span className={clsx('absolute top-0.5 h-4 w-4 rounded-full transition-all', checked ? 'left-[18px] bg-black' : 'left-0.5 bg-muted')} />
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
    <div className="flex rounded-md border border-line-strong bg-panel-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          onMouseUp={(e) => e.currentTarget.blur()}
          className={clsx(
            'flex-1 rounded px-2 py-1 text-xs font-medium transition-colors',
            value === o.value ? 'bg-panel-3 text-fg' : 'text-muted hover:text-fg',
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
