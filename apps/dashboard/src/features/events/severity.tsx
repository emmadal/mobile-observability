import { type EventSeverity, isEventSeverity } from './filters';

const SEVERITY_LABELS: Record<EventSeverity, string> = {
  trace: 'Trace',
  debug: 'Debug',
  info: 'Info',
  warn: 'Warn',
  error: 'Error',
  fatal: 'Fatal',
};

const SEVERITY_STYLES: Record<EventSeverity, string> = {
  trace: 'bg-raised text-ink-3 ring-line-strong',
  debug: 'bg-raised text-ink-2 ring-line-strong',
  info: 'bg-[color-mix(in_srgb,var(--color-series)_12%,transparent)] text-series ring-series/30',
  warn: 'bg-warning/10 text-warning ring-warning/30',
  error: 'bg-critical/10 text-critical ring-critical/30',
  fatal: 'bg-critical text-night ring-critical',
};

/** A severity is always icon-free text, so it does not depend on color alone. */
export function SeverityBadge({ severity, count }: { severity: string; count?: number }) {
  const key: EventSeverity = isEventSeverity(severity) ? severity : 'info';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium ring-1 ring-inset ${SEVERITY_STYLES[key]}`}
    >
      {SEVERITY_LABELS[key]}
      {count !== undefined && <span className="tabular opacity-80">{count}</span>}
    </span>
  );
}

export function severityLabel(severity: string): string {
  return SEVERITY_LABELS[isEventSeverity(severity) ? severity : 'info'];
}
