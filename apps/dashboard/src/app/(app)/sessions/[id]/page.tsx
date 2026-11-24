import { METRIC_LABELS, type MetricName } from '@mobile-observability/protocol';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { type ReactNode, Suspense } from 'react';
import { type Health, HealthBadge, PageHeader, Panel } from '@/components/ui';
import { SeverityBadge } from '@/features/events/severity';
import { formatDuration } from '@/features/overview/format';
import { getOrgContext } from '@/features/projects/access';
import {
  getSessionDetail,
  type SessionDetailView,
  type SessionError,
} from '@/features/sessions/service';
import { formatCount, formatDateTime, formatElapsed, shortId } from '@/features/telemetry/format';

export const metadata = { title: 'Session' };

const STATUS_HEALTH: Record<'ok' | 'errored' | 'crashed' | 'abnormal', Health> = {
  ok: 'good',
  errored: 'warning',
  crashed: 'critical',
  abnormal: 'warning',
};

const STATUS_LABELS: Record<'ok' | 'errored' | 'crashed' | 'abnormal', string> = {
  ok: 'OK',
  errored: 'Errored',
  crashed: 'Crashed',
  abnormal: 'Abnormal',
};

const dateTime = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
});

function metricLabel(name: string): string {
  return METRIC_LABELS[name as MetricName] ?? name;
}

export default function SessionDetailPage({ params }: PageProps<'/sessions/[id]'>) {
  return (
    <Suspense fallback={<SessionSkeleton />}>
      <SessionContent params={params} />
    </Suspense>
  );
}

async function SessionContent({ params }: Pick<PageProps<'/sessions/[id]'>, 'params'>) {
  const context = await getOrgContext();
  if (!context) {
    return (
      <div className="px-5 py-8 sm:px-8">
        <p className="text-sm text-ink-2">This account is not part of a workspace yet.</p>
      </div>
    );
  }

  const { id } = await params;
  const numericId = Number(id);
  const detail = await getSessionDetail(context.organizationId, numericId);
  if (!detail) notFound();

  const { session } = detail;
  return (
    <>
      <PageHeader
        title={`Session ${shortId(session.sessionId)}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{session.projectName}</span>
            <span aria-hidden="true">·</span>
            <span>
              {session.appVersion} ({session.appBuild})
            </span>
            <span aria-hidden="true">·</span>
            <span className="capitalize">{session.platform}</span>
            {session.updateId && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-2xs">update {shortId(session.updateId)}</span>
              </>
            )}
          </span>
        }
        aside={
          <Link href="/sessions" className="rounded text-xs text-ink-2 hover:text-ink">
            ← Back to sessions
          </Link>
        }
      />

      <div className="flex flex-col gap-4 px-5 py-6 sm:px-8">
        <Panel>
          <dl className="grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
            <Stat
              label="Status"
              value={
                <HealthBadge
                  health={STATUS_HEALTH[session.status]}
                  label={STATUS_LABELS[session.status]}
                />
              }
              detail={`${formatCount(session.errorCount)} errors`}
            />
            <Stat
              label="Duration"
              value={session.endedAt ? formatElapsed(session.startedAt, session.endedAt) : 'Open'}
              detail={
                session.endedAt
                  ? `Ended ${dateTime.format(session.endedAt)} UTC`
                  : `Last seen ${dateTime.format(session.lastSeenAt)} UTC`
              }
            />
            <Stat label="Started" value={dateTime.format(session.startedAt)} detail="UTC" />
            <Stat
              label="User"
              value={session.userId ? shortId(session.userId) : 'Anonymous'}
              detail={session.userId ?? session.installationId}
            />
          </dl>
        </Panel>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex flex-col gap-4">
            <ErrorsPanel detail={detail} />
            <MetricsPanel detail={detail} />
            <RequestsPanel detail={detail} />
            <EventsPanel detail={detail} />
          </div>
          <div className="flex flex-col gap-4">
            <DevicePanel detail={detail} />
          </div>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, detail }: { label: string; value: ReactNode; detail: string }) {
  return (
    <div className="flex flex-col gap-1 border-line px-5 py-4 max-sm:border-b max-sm:odd:border-r">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="font-wide text-lg font-semibold tracking-tight text-ink">{value}</dd>
      <dd className="truncate text-2xs text-ink-3" title={detail}>
        {detail}
      </dd>
    </div>
  );
}

function ErrorsPanel({ detail }: { detail: SessionDetailView }) {
  return (
    <Panel
      title="Errors"
      description={`${formatCount(detail.errors.length)} events in this session, newest first.`}
    >
      {detail.errors.length === 0 ? (
        <p className="px-5 pt-3 pb-5 text-sm text-ink-2">
          No errors were recorded during this session.
        </p>
      ) : (
        <ul className="mt-3 border-t border-line">
          {detail.errors.map((error) => (
            <ErrorRow key={error.id} error={error} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ErrorRow({ error }: { error: SessionError }) {
  return (
    <li className="border-b border-line last:border-b-0">
      <Link
        href={`/issues/${error.issueId}`}
        className="flex items-start justify-between gap-4 px-5 py-3 hover:bg-raised/40"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">{error.type}</span>
            {error.fatal && <HealthBadge health="critical" label="Fatal" />}
          </div>
          <p className="font-narrow mt-0.5 truncate text-xs text-ink-2">{error.message}</p>
          {error.routeName && (
            <p className="mt-0.5 truncate font-mono text-2xs text-ink-3">{error.routeName}</p>
          )}
        </div>
        <time
          dateTime={error.timestamp.toISOString()}
          className="shrink-0 text-2xs text-ink-3 tabular"
        >
          {dateTime.format(error.timestamp)}
        </time>
      </Link>
    </li>
  );
}

function MetricsPanel({ detail }: { detail: SessionDetailView }) {
  return (
    <Panel
      title="Performance metrics"
      description="Startup and navigation samples from this session."
    >
      {detail.metrics.length === 0 ? (
        <p className="px-5 pt-3 pb-5 text-sm text-ink-2">No metrics recorded.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-xs">
            <thead className="border-y border-line text-ink-3">
              <tr>
                <th scope="col" className="px-5 py-2 font-medium">
                  Metric
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Route
                </th>
                <th scope="col" className="px-5 py-2 text-right font-medium">
                  Value / time
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.metrics.map((metric) => (
                <tr key={metric.id} className="border-b border-line last:border-b-0">
                  <td className="px-5 py-2 text-ink-2">{metricLabel(metric.name)}</td>
                  <td className="px-3 py-2 font-mono text-2xs text-ink-3">
                    {metric.routeName ?? '—'}
                  </td>
                  <td className="px-5 py-2 text-right whitespace-nowrap text-ink tabular">
                    {formatDuration(metric.valueMs)}
                    <span className="ml-2 text-2xs text-ink-3">
                      {dateTime.format(metric.timestamp)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function RequestsPanel({ detail }: { detail: SessionDetailView }) {
  return (
    <Panel title="Network" description="Requests captured during this session.">
      {detail.requests.length === 0 ? (
        <p className="px-5 pt-3 pb-5 text-sm text-ink-2">No network requests recorded.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-xs">
            <thead className="border-y border-line text-ink-3">
              <tr>
                <th scope="col" className="px-5 py-2 font-medium">
                  Request
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Status
                </th>
                <th scope="col" className="px-5 py-2 text-right font-medium">
                  Duration
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.requests.map((request) => (
                <tr key={request.id} className="border-b border-line last:border-b-0">
                  <td className="max-w-0 px-5 py-2">
                    <p className="truncate font-mono text-2xs text-ink-2">
                      {request.method} {request.host}
                      {request.path}
                    </p>
                    {request.error && (
                      <p className="truncate text-2xs text-critical">{request.error}</p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular">
                    <span className={request.statusCode >= 400 ? 'text-critical' : 'text-ink-2'}>
                      {request.statusCode}
                    </span>
                  </td>
                  <td className="px-5 py-2 text-right whitespace-nowrap text-ink-2 tabular">
                    {formatDuration(request.durationMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function EventsPanel({ detail }: { detail: SessionDetailView }) {
  const projectId = detail.session.projectId;
  return (
    <Panel
      title="Events"
      description={`${formatCount(detail.events.length)} Observe.logEvent calls captured during this session.`}
    >
      {detail.events.length === 0 ? (
        <p className="px-5 pt-3 pb-5 text-sm text-ink-2">No log events recorded.</p>
      ) : (
        <ul className="mt-3 border-t border-line">
          {detail.events.map((event) => {
            const attributes = event.attributes ?? {};
            const attributeCount = Object.keys(attributes).length;
            return (
              <li key={event.id} className="border-b border-line px-5 py-3 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2 text-2xs text-ink-3">
                  <time dateTime={event.timestamp.toISOString()} className="tabular">
                    {dateTime.format(event.timestamp)}
                  </time>
                  <SeverityBadge severity={event.severity} />
                  <Link
                    href={`/events/detail?range=30d&project=${encodeURIComponent(projectId)}&name=${encodeURIComponent(event.name)}`}
                    className="font-mono text-xs font-medium text-ink hover:underline"
                  >
                    {event.name}
                  </Link>
                  {event.displayName && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-ink-2">{event.displayName}</span>
                    </>
                  )}
                </div>
                {event.body && (
                  <p className="font-narrow mt-1 whitespace-pre-wrap break-words text-xs text-ink-2">
                    {event.body}
                  </p>
                )}
                {attributeCount > 0 && (
                  <details className="mt-1.5 text-2xs text-ink-3">
                    <summary className="w-fit cursor-pointer rounded hover:text-ink-2">
                      Attributes ({attributeCount})
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-line bg-night p-3 font-mono text-2xs text-ink-2">
                      {JSON.stringify(attributes, null, 2)}
                    </pre>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function DevicePanel({ detail }: { detail: SessionDetailView }) {
  const { session } = detail;
  return (
    <Panel title="Session details">
      <dl className="mt-3 border-t border-line text-xs">
        <Row label="Session id" value={session.sessionId} mono />
        <Row label="Installation" value={session.installationId} mono />
        <Row label="Project" value={session.projectName} />
        <Row label="Environment" value={session.environment} />
        <Row label="Platform" value={session.platform} />
        <Row label="OS version" value={session.osVersion ?? 'Unknown'} />
        <Row
          label="Device"
          value={
            session.deviceBrand || session.deviceModel
              ? [session.deviceBrand, session.deviceModel].filter(Boolean).join(' ')
              : 'Unknown'
          }
        />
        <Row label="Locale" value={session.deviceLocale ?? '—'} />
        <Row
          label="Environment type"
          value={session.isEmulator === null ? '—' : session.isEmulator ? 'Emulator' : 'Physical'}
        />
        <Row label="IP address" value={session.clientIp ?? 'Not captured'} mono />
        <Row
          label="Location"
          value={
            session.clientCountry || session.clientCity
              ? [session.clientCity, session.clientCountry].filter(Boolean).join(', ')
              : 'Unknown'
          }
        />
        <Row label="App version" value={`${session.appVersion} (${session.appBuild})`} />
        <Row label="Runtime" value={session.runtimeVersion ?? '—'} mono />
        <Row label="Update" value={session.updateId ?? '—'} mono />
        <Row label="Started" value={formatDateTime(session.startedAt)} />
        <Row label="Last seen" value={formatDateTime(session.lastSeenAt)} />
        {session.endedAt && <Row label="Ended" value={formatDateTime(session.endedAt)} />}
      </dl>
    </Panel>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line px-5 py-2 last:border-b-0">
      <dt className="shrink-0 text-ink-3">{label}</dt>
      <dd
        className={`min-w-0 truncate text-right text-ink-2 ${mono ? 'font-mono text-2xs' : ''}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

function SessionSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4 px-5 py-6 sm:px-8">
      <div className="h-24 motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
      <div className="h-64 motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
    </div>
  );
}
