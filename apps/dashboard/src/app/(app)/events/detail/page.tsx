import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { PageHeader, Panel } from '@/components/ui';
import {
  EVENT_SEVERITIES,
  EVENT_SEVERITY_FILTERS,
  type EventSeverityFilter,
  eventQuery,
  MAX_EVENT_ATTRIBUTE_LENGTH,
  MAX_EVENT_ATTRIBUTE_VALUE_LENGTH,
  parseEventName,
  parseEventSeverity,
  singleParam,
} from '@/features/events/filters';
import {
  EVENT_OCCURRENCES_PAGE_SIZE,
  type EventAttributeValue,
  type EventDetailView,
  type EventOccurrence,
  getEventDetail,
} from '@/features/events/service';
import { SeverityBadge } from '@/features/events/severity';
import { parseOverviewFilters, rangeLabel, resolveWindow } from '@/features/overview/filters';
import { OverviewFrame } from '@/features/overview/overview-frame';
import { getFilterOptions } from '@/features/overview/service';
import { OverviewToolbar } from '@/features/overview/toolbar';
import { getOrgContext } from '@/features/projects/access';
import { formatCount, formatDateTime, shortId, timeAgo } from '@/features/telemetry/format';

export const metadata = { title: 'Event' };

const SEVERITY_LABELS: Record<EventSeverityFilter, string> = {
  all: 'All',
  trace: 'Trace',
  debug: 'Debug',
  info: 'Info',
  warn: 'Warn',
  error: 'Error',
  fatal: 'Fatal',
};

export default function EventDetailPage({ searchParams }: PageProps<'/events/detail'>) {
  return (
    <Suspense fallback={<EventSkeleton />}>
      <EventContent searchParams={searchParams} />
    </Suspense>
  );
}

async function EventContent({ searchParams }: Pick<PageProps<'/events/detail'>, 'searchParams'>) {
  const context = await getOrgContext();
  if (!context) {
    return (
      <div className="px-5 py-8 sm:px-8">
        <p className="text-sm text-ink-2">This account is not part of a workspace yet.</p>
      </div>
    );
  }

  const params = await searchParams;
  const name = parseEventName(params);
  if (!name) notFound();

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
  const attrKey = singleParam(params.attr, MAX_EVENT_ATTRIBUTE_LENGTH) ?? null;
  const attrValue = singleParam(params.attrValue, MAX_EVENT_ATTRIBUTE_VALUE_LENGTH) ?? null;
  const attributeFilter = attrKey && attrValue ? { attrKey, attrValue } : null;
  const window = resolveWindow(filters.range, now);
  const detail = await getEventDetail(options, filters, window, name, {
    severity,
    attrKey: attributeFilter?.attrKey ?? null,
    attrValue: attributeFilter?.attrValue ?? null,
    cursor: singleParam(params.cursor, 512) ?? null,
  });
  if (!detail) notFound();

  const severityTotal = EVENT_SEVERITIES.reduce((total, key) => total + detail.severities[key], 0);

  return (
    <>
      <PageHeader
        title={detail.displayName ?? detail.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{detail.name}</span>
            <span aria-hidden="true">·</span>
            <span>{rangeLabel(filters.range)}</span>
          </span>
        }
        aside={
          <Link href={`/events?${eventQuery(filters, {})}`} className="hover:text-ink">
            ← Back to events
          </Link>
        }
      />
      <OverviewFrame
        filters={filters}
        toolbar={<OverviewToolbar options={options} asOf={now.toISOString()} />}
      >
        <div className="flex flex-col gap-4 px-5 py-6 sm:px-8">
          <Panel>
            <dl className="grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
              <Stat
                label="Events"
                value={formatCount(detail.totals.events)}
                detail="Matching filters"
              />
              <Stat
                label="Sessions"
                value={formatCount(detail.totals.sessions)}
                detail="With this event"
              />
              <Stat
                label="Users"
                value={formatCount(detail.totals.users)}
                detail="Identified users"
              />
              <Stat
                label="Projects"
                value={formatCount(detail.totals.projects)}
                detail="Sending this event"
              />
              <Stat
                label="First seen"
                value={detail.totals.firstSeen ? formatDateTime(detail.totals.firstSeen) : '—'}
                detail={
                  detail.totals.firstSeen
                    ? timeAgo(detail.totals.firstSeen, now.getTime())
                    : 'No data'
                }
              />
              <Stat
                label="Last seen"
                value={detail.totals.lastSeen ? formatDateTime(detail.totals.lastSeen) : '—'}
                detail={
                  detail.totals.lastSeen
                    ? timeAgo(detail.totals.lastSeen, now.getTime())
                    : 'No data'
                }
              />
            </dl>
          </Panel>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav aria-label="Event severity" className="flex flex-wrap items-center gap-1">
              {EVENT_SEVERITY_FILTERS.map((key) => {
                const selected = severity === key;
                const total = key === 'all' ? severityTotal : detail.severities[key];
                return (
                  <Link
                    key={key}
                    href={`/events/detail?${eventQuery(filters, {
                      name,
                      severity: key === 'all' ? null : key,
                      attr: attributeFilter?.attrKey,
                      attrValue: attributeFilter?.attrValue,
                    })}`}
                    aria-current={selected ? 'page' : undefined}
                    className={
                      selected
                        ? 'flex items-center gap-2 rounded-md bg-raised px-3 py-1.5 text-xs font-semibold text-ink'
                        : 'flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-ink-2 hover:bg-raised/60 hover:text-ink'
                    }
                  >
                    {SEVERITY_LABELS[key]}
                    <span className="text-2xs text-ink-3 tabular">{formatCount(total)}</span>
                  </Link>
                );
              })}
            </nav>
            {attributeFilter && (
              <div className="flex items-center gap-2 rounded-md border border-line-strong bg-raised px-3 py-1.5 text-xs text-ink-2">
                <span>
                  Attribute <code className="font-mono text-ink">{attributeFilter.attrKey}</code> ={' '}
                  <code className="font-mono text-ink">{attributeFilter.attrValue}</code>
                </span>
                <Link
                  href={`/events/detail?${eventQuery(filters, {
                    name,
                    severity: severity === 'all' ? null : severity,
                  })}`}
                  className="text-ink-3 hover:text-ink"
                >
                  Clear
                </Link>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <OccurrencesPanel
              detail={detail}
              filters={filters}
              severity={severity}
              attributeFilter={attributeFilter}
              cursor={singleParam(params.cursor, 512) ?? null}
              now={now}
            />
            <div className="flex flex-col gap-4">
              <AttributesPanel
                detail={detail}
                filters={filters}
                severity={severity}
                attributeFilter={attributeFilter}
              />
            </div>
          </div>
        </div>
      </OverviewFrame>
    </>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="flex flex-col gap-1 border-line px-5 py-4 max-sm:border-b max-sm:odd:border-r">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="font-wide text-sm font-semibold tracking-tight text-ink">{value}</dd>
      <dd className="truncate text-2xs text-ink-3" title={detail}>
        {detail}
      </dd>
    </div>
  );
}

function OccurrencesPanel({
  detail,
  filters,
  severity,
  attributeFilter,
  cursor,
  now,
}: {
  detail: EventDetailView;
  filters: ReturnType<typeof parseOverviewFilters>;
  severity: EventSeverityFilter;
  attributeFilter: { attrKey: string; attrValue: string } | null;
  cursor: string | null;
  now: Date;
}) {
  const params = {
    name: detail.name,
    severity: severity === 'all' ? null : severity,
    attr: attributeFilter?.attrKey,
    attrValue: attributeFilter?.attrValue,
  };
  return (
    <Panel
      title="Occurrences"
      description={`Newest first · ${formatCount(detail.occurrences.length)} shown of ${formatCount(detail.totals.events)} in this view.`}
    >
      {detail.occurrences.length === 0 ? (
        <p className="px-5 pt-3 pb-5 text-sm text-ink-2">
          No events match these filters. Try a wider time range or clear the severity and attribute
          filters.
        </p>
      ) : (
        <ul className="mt-3 border-t border-line">
          {detail.occurrences.map((occurrence) => (
            <OccurrenceRow key={occurrence.id} occurrence={occurrence} now={now} />
          ))}
        </ul>
      )}
      {(detail.cursor || cursor) && (
        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
          <p className="text-2xs text-ink-3">{EVENT_OCCURRENCES_PAGE_SIZE} events per page</p>
          <div className="flex items-center gap-3 text-xs">
            {cursor && (
              <Link
                href={`/events/detail?${eventQuery(filters, params)}`}
                className="text-ink-3 hover:text-ink"
              >
                Back to newest
              </Link>
            )}
            {detail.cursor && (
              <Link
                href={`/events/detail?${eventQuery(filters, {
                  ...params,
                  cursor: detail.cursor,
                })}`}
                className="font-medium text-ink hover:underline"
              >
                Older events
              </Link>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

function OccurrenceRow({ occurrence, now }: { occurrence: EventOccurrence; now: Date }) {
  const attributes = occurrence.attributes ?? {};
  const attributeCount = Object.keys(attributes).length;
  return (
    <li className="border-b border-line px-5 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2 text-2xs text-ink-3">
        <SeverityBadge severity={occurrence.severity} />
        <time dateTime={occurrence.timestamp.toISOString()} className="tabular">
          {formatDateTime(occurrence.timestamp)}
        </time>
        <span aria-hidden="true">·</span>
        <span className="text-ink-2">{occurrence.projectName}</span>
        <span aria-hidden="true">·</span>
        <span>
          {occurrence.appVersion} ({occurrence.appBuild})
        </span>
        {occurrence.updateId && (
          <>
            <span aria-hidden="true">·</span>
            <span className="font-mono">update {shortId(occurrence.updateId)}</span>
          </>
        )}
        <span aria-hidden="true">·</span>
        <span className="capitalize">{occurrence.platform}</span>
        <span aria-hidden="true">·</span>
        <span>{occurrence.environment}</span>
        <span aria-hidden="true">·</span>
        <span>{timeAgo(occurrence.timestamp, now.getTime())}</span>
      </div>

      {occurrence.displayName && (
        <p className="mt-1 text-sm font-medium text-ink">{occurrence.displayName}</p>
      )}
      {occurrence.body && (
        <p className="font-narrow mt-1 whitespace-pre-wrap break-words text-xs text-ink-2">
          {occurrence.body}
        </p>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-3">
        {occurrence.deviceModel && <span>{occurrence.deviceModel}</span>}
        {occurrence.osVersion && <span>OS {occurrence.osVersion}</span>}
        {occurrence.userId && <span className="font-mono">user {shortId(occurrence.userId)}</span>}
        {occurrence.sessionRowId ? (
          <Link
            href={`/sessions/${occurrence.sessionRowId}`}
            className="font-mono text-ink-2 hover:text-ink hover:underline"
          >
            session {shortId(occurrence.sessionId ?? '')}
          </Link>
        ) : (
          occurrence.sessionId && (
            <Link
              href={`/sessions?q=${encodeURIComponent(occurrence.sessionId)}`}
              className="font-mono text-ink-2 hover:text-ink hover:underline"
            >
              session {shortId(occurrence.sessionId)}
            </Link>
          )
        )}
      </div>

      {attributeCount > 0 && (
        <details className="mt-2 text-2xs text-ink-3">
          <summary className="w-fit cursor-pointer rounded hover:text-ink-2">
            Attributes ({attributeCount})
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-line bg-night p-3 font-mono text-2xs text-ink-2">
            {JSON.stringify(attributes, null, 2)}
          </pre>
        </details>
      )}
    </li>
  );
}

function AttributesPanel({
  detail,
  filters,
  severity,
  attributeFilter,
}: {
  detail: EventDetailView;
  filters: ReturnType<typeof parseOverviewFilters>;
  severity: EventSeverityFilter;
  attributeFilter: { attrKey: string; attrValue: string } | null;
}) {
  const grouped = new Map<string, EventAttributeValue[]>();
  for (const attribute of detail.attributes) {
    const values = grouped.get(attribute.key);
    if (values) values.push(attribute);
    else grouped.set(attribute.key, [attribute]);
  }

  return (
    <Panel
      title="Attribute breakdown"
      description="Values seen in this range. Select one to filter occurrences."
    >
      {detail.attributes.length === 0 ? (
        <p className="px-5 pt-3 pb-5 text-sm text-ink-2">No attributes recorded for this event.</p>
      ) : (
        <div className="mt-3 divide-y divide-line border-t border-line">
          {[...grouped.entries()].map(([key, values]) => (
            <div key={key} className="px-5 py-3">
              <p className="font-mono text-2xs font-medium text-ink-2">{key}</p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {values.map((attribute) => {
                  const selected =
                    attributeFilter?.attrKey === key &&
                    attributeFilter.attrValue === attribute.value;
                  return (
                    <li key={`${key}:${attribute.value}`}>
                      <Link
                        href={`/events/detail?${eventQuery(filters, {
                          name: detail.name,
                          severity: severity === 'all' ? null : severity,
                          attr: key,
                          attrValue: attribute.value,
                        })}`}
                        aria-current={selected ? 'true' : undefined}
                        className={`flex items-center justify-between gap-2 rounded px-1.5 py-1 text-xs transition-colors ${
                          selected
                            ? 'bg-raised text-ink'
                            : 'text-ink-2 hover:bg-raised/60 hover:text-ink'
                        }`}
                      >
                        <span
                          className="min-w-0 truncate font-mono text-2xs"
                          title={attribute.value}
                        >
                          {attribute.value || '—'}
                        </span>
                        <span className="shrink-0 text-2xs text-ink-3 tabular">
                          {formatCount(attribute.count)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function EventSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4 px-5 py-6 sm:px-8">
      <div className="h-24 motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
      <div className="h-8 w-96 motion-safe:animate-pulse rounded-md bg-raised" />
      <div className="h-80 motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
    </div>
  );
}
