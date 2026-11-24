import { type OverviewFilters, toSearchParams } from '@/features/overview/filters';

/** Structured log event (Observe.logEvent) filter model, shared by the Events pages. */

export const EVENT_SEVERITIES = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type EventSeverity = (typeof EVENT_SEVERITIES)[number];

export const EVENT_SEVERITY_FILTERS = ['all', ...EVENT_SEVERITIES] as const;
export type EventSeverityFilter = (typeof EVENT_SEVERITY_FILTERS)[number];
export const DEFAULT_EVENT_SEVERITY: EventSeverityFilter = 'all';

export const MAX_EVENT_SEARCH_LENGTH = 64;
export const MAX_EVENT_NAME_LENGTH = 128;
export const MAX_EVENT_ATTRIBUTE_LENGTH = 128;
export const MAX_EVENT_ATTRIBUTE_VALUE_LENGTH = 512;

type SearchParams = Record<string, string | string[] | undefined>;

/** One URL value, trimmed and capped so hand-edited URLs cannot blow up a query. */
export function singleParam(
  value: string | string[] | undefined,
  maxLength: number,
): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

export function parseEventSeverity(value: string | string[] | undefined): EventSeverityFilter {
  const severity = singleParam(value, 16);
  return EVENT_SEVERITY_FILTERS.includes(severity as EventSeverityFilter)
    ? (severity as EventSeverityFilter)
    : DEFAULT_EVENT_SEVERITY;
}

export function isEventSeverity(value: string): value is EventSeverity {
  return EVENT_SEVERITIES.includes(value as EventSeverity);
}

/** An exact event name; over-long names are rejected instead of silently truncated. */
export function parseEventName(params: SearchParams): string | null {
  const first = Array.isArray(params.name) ? params.name[0] : params.name;
  const name = first?.trim();
  return name && name.length <= MAX_EVENT_NAME_LENGTH ? name : null;
}

/** Event links keep the overview filters and add the page-specific params. */
export function eventQuery(
  filters: OverviewFilters,
  extra: Record<string, string | null | undefined>,
): string {
  const query = toSearchParams(filters);
  for (const [key, value] of Object.entries(extra)) {
    if (value) query.set(key, value);
    else query.delete(key);
  }
  return query.toString();
}
