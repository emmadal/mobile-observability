import type { ReactNode } from 'react';
import { CheckIcon, CrashIcon, WarningIcon } from './icons';

/** Class names shared by forms across the dashboard. */
export const inputClass =
  'mt-1.5 block w-full rounded-md border border-line-strong bg-night px-3 py-2 text-sm text-ink placeholder:text-ink-3 outline-none transition-colors hover:border-ink-3 focus:border-focus focus-visible:outline-none focus:ring-2 focus:ring-focus/30 disabled:opacity-60';

export const labelClass = 'block text-xs font-medium text-ink-2';

export const primaryButtonClass =
  'inline-flex h-9 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-night transition-colors hover:bg-white disabled:cursor-progress disabled:opacity-60';

export const secondaryButtonClass =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-line-strong px-3 text-xs font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink disabled:cursor-progress disabled:opacity-60';

export const dangerButtonClass =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-line-strong px-3 text-xs font-medium text-ink-2 transition-colors hover:border-critical/70 hover:text-critical disabled:cursor-progress disabled:opacity-60';

export function PageHeader({
  title,
  description,
  aside,
}: {
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line px-5 py-5 sm:px-8">
      <div className="min-w-0">
        <h1 className="font-wide text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-2">{description}</p>}
      </div>
      {aside && <div className="text-xs text-ink-3">{aside}</div>}
    </div>
  );
}

/** A titled block of the dashboard grid. */
export function Panel({
  title,
  description,
  action,
  children,
  className = '',
  id,
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`min-w-0 rounded-[10px] border border-line bg-panel ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-ink-3">{description}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export type Health = 'good' | 'warning' | 'critical';

const healthStyles: Record<Health, { className: string; icon: ReactNode }> = {
  good: { className: 'text-good bg-good/10 ring-good/30', icon: <CheckIcon /> },
  warning: { className: 'text-warning bg-warning/10 ring-warning/30', icon: <WarningIcon /> },
  critical: { className: 'text-critical bg-critical/10 ring-critical/30', icon: <CrashIcon /> },
};

/** State is never color alone: icon plus a word. */
export function HealthBadge({ health, label }: { health: Health; label: string }) {
  const style = healthStyles[health];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-2xs font-medium ring-1 ring-inset ${style.className}`}
    >
      <span className="[&>svg]:size-3">{style.icon}</span>
      {label}
    </span>
  );
}

export function FieldError({ id, message }: { id?: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1.5 text-2xs text-critical">
      {message}
    </p>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-ink"
    >
      {message}
    </p>
  );
}
