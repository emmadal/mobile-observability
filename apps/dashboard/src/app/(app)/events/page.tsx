import { SearchIcon } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { PageHeader, Panel } from '@/components/ui';
import {
  EVENT_SEVERITIES,
  EVENT_SEVERITY_FILTERS,
  type EventSeverity,
  type EventSeverityFilter,
  eventQuery,
  MAX_EVENT_SEARCH_LENGTH,
  parseEventSeverity,
  singleParam,
} from '@/features/events/filters';
import { EVENTS_PAGE_SIZE, type EventListItem, listEvents } from '@/features/events/service';
import { SeverityBadge } from '@/features/events/severity';
import {
  parseOverviewFilters,
  rangeLabel,
  resolveWindow,
  toSearchParams,
} from '@/features/overview/filters';
import { OverviewFrame } from '@/features/overview/overview-frame';
import { getFilterOptions } from '@/features/overview/service';
import { OverviewToolbar } from '@/features/overview/toolbar';
import { getOrgContext } from '@/features/projects/access';
import { formatCompact, formatCount, formatDateTime, timeAgo } from '@/features/telemetry/format';

export const metadata = { title: 'Events' };

const SEVERITY_LABELS: Record<EventSeverityFilter, string> = {
  all: 'All',
  trace: 'Trace',
  debug: 'Debug',
  info: 'Info',
  warn: 'Warn',
  error: 'Error',
  fatal: 'Fatal',
};

export default function EventsPage({ searchParams }: PageProps<'/events'>) {
  return (
    <>
      <PageHeader
        title="Events"
        description="Structured logs from Observe.logEvent, grouped by event name."
        aside="Times in UTC"
      />
      <Suspense fallback={<EventsSkeleton />}>
        <EventsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function EventsContent({ searchParams }: Pick<PageProps<'/events'>, 'searchParams'>) {
  const context = await getOrgContext();
  if (!context) {
    return (
      <div className="px-5 py-8 sm:px-8">
        <p className="text-sm text-ink-2">This account is not part of a workspace yet.</p>
      </div>
    );
  }

  const params = await searchParams;
  const now = new Date();
  const parsed = parseOverviewFilters(params, now);
  const options = await getFilterOptions(context.organizationId);
  if (options.projects.length === 0) {
    return (
      <div className="px-5 py-8 sm:px-8">
        <Panel title="No projects yet" className="max-w-2xl">
          <p className="px-5 pt-2 pb-5 text-sm text-ink-2">
            Create a project in Settings, then log events from your app appear here automatically.
          </p>
        </Panel>
      </div>
    );
  }

  const filters = options.projects.some((project) => project.id === parsed.project)
    ? parsed
    : { ...parsed, project: null };
  const severity = parseEventSeverity(params.severity);
  const query = singleParam(params.q, MAX_EVENT_SEARCH_LENGTH) ?? null;
  const window = resolveWindow(filters.range, now);
  const page = await listEvents(options, filters, window, {
    severity,
    query,
    cursor: singleParam(params.cursor, 512) ?? null,
  });

  return (
    <OverviewFrame
      filters={filters}
      toolbar={<OverviewToolbar options={options} asOf={now.toISOString()} />}
    >
      <div className="flex flex-col gap-4 px-5 py-6 sm:px-8">
        <Panel>
          <dl className="grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
            <Stat
              label="Events"
              value={formatCompact(page.totals.events)}
              detail="Observe.logEvent calls"
            />
            <Stat
              label="Event names"
              value={formatCount(page.totals.names)}
              detail="Distinct names"
            />
            <Stat
              label="Sessions"
              value={formatCompact(page.totals.sessions)}
              detail="With at least one event"
            />
            <Stat
              label="Users"
              value={formatCompact(page.totals.users)}
              detail="Identified users"
            />
          </dl>
        </Panel>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label="Event severity" className="flex flex-wrap items-center gap-1">
            {EVENT_SEVERITY_FILTERS.map((key) => {
              const selected = severity === key;
              return (
                <Link
                  key={key}
                  href={`/events?${eventQuery(filters, {
                    severity: key === 'all' ? null : key,
                    q: query,
                  })}`}
                  aria-current={selected ? 'page' : undefined}
                  className={
                    selected
                      ? 'flex items-center gap-2 rounded-md bg-raised px-3 py-1.5 text-xs font-semibold text-ink'
                      : 'flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-ink-2 hover:bg-raised/60 hover:text-ink'
                  }
                >
                  {SEVERITY_LABELS[key]}
                  <span className="text-2xs text-ink-3 tabular">
                    {formatCount(page.counts[key])}
                  </span>
                </Link>
              );
            })}
          </nav>

          <form action="/events" method="get" className="flex items-center gap-2">
            {[...toSearchParams(filters)].map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
            {severity !== 'all' && <input type="hidden" name="severity" value={severity} />}
            <label htmlFor="event-search" className="sr-only">
              Search events
            </label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
              <input
                id="event-search"
                name="q"
                type="search"
                defaultValue={query ?? ''}
                maxLength={MAX_EVENT_SEARCH_LENGTH}
                placeholder="Search name, display name or body"
                className="h-8 w-64 rounded-md border border-line-strong bg-night pr-3 pl-8 text-xs text-ink placeholder:text-ink-3 outline-none transition-colors hover:border-ink-3 focus:border-focus focus:ring-2 focus:ring-focus/30"
              />
            </div>
            <button
              type="submit"
              className="h-8 rounded-md border border-line-strong px-3 text-xs font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
            >
              Search
            </button>
            {query && (
              <Link
                href={`/events?${eventQuery(filters, {
                  severity: severity === 'all' ? null : severity,
                  q: null,
                })}`}
                className="text-xs text-ink-3 hover:text-ink"
              >
                Clear
              </Link>
            )}
          </form>
        </div>

        <Panel
          title="Event groups"
          description={`${rangeLabel(filters.range)} · ${formatCount(page.totals.events)} events across ${formatCount(page.totals.names)} names`}
        >
          {page.events.length === 0 ? (
            <p className="px-5 pt-3 pb-5 text-sm text-ink-2">
              No log events match these filters. Call Observe.logEvent from your app and its events
              appear here.
            </p>
          ) : (
            <EventTable filters={filters} events={page.events} now={now.getTime()} />
          )}
          {(page.cursor || params.cursor) && (
            <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
              <p className="text-2xs text-ink-3">
                Newest activity first · {EVENTS_PAGE_SIZE} event names per page
              </p>
              <div className="flex items-center gap-3 text-xs">
                {params.cursor && (
                  <Link
                    href={`/events?${eventQuery(filters, {
                      severity: severity === 'all' ? null : severity,
                      q: query,
                    })}`}
                    className="text-ink-3 hover:text-ink"
                  >
                    Back to newest
                  </Link>
                )}
                {page.cursor && (
                  <Link
                    href={`/events?${eventQuery(filters, {
                      severity: severity === 'all' ? null : severity,
                      q: query,
                      cursor: page.cursor,
                    })}`}
                    className="font-medium text-ink hover:underline"
                  >
                    Older event names
                  </Link>
                )}
              </div>
            </div>
          )}
        </Panel>
      </div>
    </OverviewFrame>
  );
}

function EventTable({
  filters,
  events,
  now,
}: {
  filters: ReturnType<typeof parseOverviewFilters>;
  events: EventListItem[];
  now: number;
}) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[52rem] text-left text-xs">
        <thead className="border-y border-line text-ink-3">
          <tr>
            <th scope="col" className="w-[38%] px-5 py-2 font-medium">
              Event
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Events
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Sessions
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Users
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Projects
            </th>
            <th scope="col" className="px-5 py-2 text-right font-medium">
              Last seen
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr
              key={event.name}
              className="border-b border-line last:border-b-0 hover:bg-raised/40"
            >
              <td className="px-5 py-3">
                <Link
                  href={`/events/detail?${eventQuery(filters, { name: event.name })}`}
                  className="block wrap-anywhere font-mono text-xs font-medium text-ink hover:underline"
                  title={event.name}
                >
                  {event.name}
                </Link>
                {event.displayName && (
                  <p className="font-narrow mt-0.5 wrap-anywhere text-2xs text-ink-2">
                    {event.displayName}
                  </p>
                )}
                <SeverityMix severities={event.severities} />
              </td>
              <td className="px-3 py-3 text-right whitespace-nowrap text-ink tabular">
                {formatCount(event.events)}
              </td>
              <td className="px-3 py-3 text-right whitespace-nowrap text-ink-2 tabular">
                {formatCount(event.sessions)}
              </td>
              <td className="px-3 py-3 text-right whitespace-nowrap text-ink-2 tabular">
                {formatCount(event.users)}
              </td>
              <td className="px-3 py-3 text-right whitespace-nowrap text-ink-2 tabular">
                {formatCount(event.projects)}
              </td>
              <td className="px-5 py-3 text-right whitespace-nowrap text-ink-3 tabular">
                <time
                  dateTime={event.lastSeen.toISOString()}
                  title={formatDateTime(event.lastSeen)}
                >
                  {timeAgo(event.lastSeen, now)}
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SeverityMix({ severities }: { severities: Record<EventSeverity, number> }) {
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1">
      {EVENT_SEVERITIES.filter((severity) => severities[severity] > 0).map((severity) => (
        <SeverityBadge key={severity} severity={severity} count={severities[severity]} />
      ))}
    </span>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="flex flex-col gap-1 border-line px-5 py-4 max-sm:border-b max-sm:odd:border-r">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="font-wide text-lg font-semibold tracking-tight text-ink">{value}</dd>
      <dd className="wrap-anywhere text-2xs text-ink-3" title={detail}>
        {detail}
      </dd>
    </div>
  );
}

function EventsSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4 px-5 py-6 sm:px-8">
      <div className="h-24 motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
      <div className="h-8 w-96 motion-safe:animate-pulse rounded-md bg-raised" />
      <div className="h-80 motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
    </div>
  );
}
