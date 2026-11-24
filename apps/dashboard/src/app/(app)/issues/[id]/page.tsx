import type { Frame } from '@mobile-observability/protocol';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { z } from 'zod';
import { setIssueStatusAction } from '@/app/actions/issues';
import { HealthBadge, Panel, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { getIssueDetail, type IssueDetailView, type IssueEvent } from '@/features/issues/service';
import { getOrgContext } from '@/features/projects/access';
import {
  deviceLabel,
  formatCount,
  formatDateTime,
  formatElapsed,
  osLabel,
  platformLabel,
  timeAgo,
} from '@/features/telemetry/format';

export const metadata = { title: 'Issue' };

const uuid = z.uuid();
const dateTime = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
});

export default function IssueDetailPage({ params }: PageProps<'/issues/[id]'>) {
  return (
    <Suspense fallback={<IssueSkeleton />}>
      <IssueContent params={params} />
    </Suspense>
  );
}

async function IssueContent({ params }: Pick<PageProps<'/issues/[id]'>, 'params'>) {
  const context = await getOrgContext();
  if (!context) {
    return (
      <div className="px-5 py-8 sm:px-8">
        <p className="text-sm text-ink-2">This account is not part of a workspace yet.</p>
      </div>
    );
  }

  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const detail = await getIssueDetail(context.organizationId, id);
  if (!detail) notFound();

  const { issue } = detail;
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line px-5 py-5 sm:px-8">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
            <Link href="/issues" className="rounded hover:text-ink">
              Issues
            </Link>
            <span aria-hidden="true">/</span>
            <span className="wrap-anywhere">{issue.projectName}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="font-wide text-xl font-semibold tracking-tight text-ink">
              {issue.type}
            </h1>
            <FixBadge origin={issue.origin} />
            {issue.fatal && <HealthBadge health="critical" label="Crash" />}
            {issue.regressed && <HealthBadge health="warning" label="Regressed" />}
            {issue.status === 'resolved' && <HealthBadge health="good" label="Resolved" />}
            {issue.status === 'ignored' && (
              <span className="rounded-full bg-raised px-2 py-0.5 text-2xs font-medium text-ink-3 ring-1 ring-line-strong ring-inset">
                Ignored
              </span>
            )}
          </div>
          <p className="font-narrow mt-1 max-w-3xl text-sm text-ink-2">{issue.message}</p>
          {issue.culprit && (
            <p className="mt-1 wrap-anywhere font-mono text-2xs text-ink-3">{issue.culprit}</p>
          )}
        </div>
        <IssueActions issueId={issue.id} status={issue.status} />
      </div>

      <div className="flex flex-col gap-4 px-5 py-6 sm:px-8">
        <Panel>
          <dl className="grid grid-cols-2 divide-line sm:grid-cols-5 sm:divide-x">
            <Stat label="Events" value={formatCount(detail.stats.events)} />
            <Stat label="Users affected" value={formatCount(detail.stats.users)} />
            <Stat label="Sessions" value={formatCount(detail.stats.sessions)} />
            <Stat
              label="First seen"
              value={timeAgo(issue.firstSeen, Date.now())}
              detail={formatDateTime(issue.firstSeen)}
            />
            <Stat
              label="Last seen"
              value={timeAgo(issue.lastSeen, Date.now())}
              detail={formatDateTime(issue.lastSeen)}
            />
          </dl>
        </Panel>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex flex-col gap-4">
            <StackPanel detail={detail} />
            <OccurrencesPanel detail={detail} />
            <BreadcrumbsPanel detail={detail} />
          </div>
          <div className="flex flex-col gap-4">
            <MetaPanel detail={detail} />
            <ReleasesPanel detail={detail} />
            <TagsPanel detail={detail} />
          </div>
        </div>
      </div>
    </>
  );
}

function FixBadge({ origin }: { origin: 'js' | 'native' }) {
  return (
    <span
      className={
        origin === 'js'
          ? 'rounded-full bg-good/10 px-2 py-0.5 text-2xs font-medium text-good ring-1 ring-good/30 ring-inset'
          : 'rounded-full bg-raised px-2 py-0.5 text-2xs font-medium text-ink-3 ring-1 ring-line-strong ring-inset'
      }
    >
      {origin === 'js' ? 'Fix via OTA update' : 'Needs new build'}
    </span>
  );
}

function IssueActions({
  issueId,
  status,
}: {
  issueId: string;
  status: 'open' | 'resolved' | 'ignored';
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== 'resolved' && (
        <form action={setIssueStatusAction}>
          <input type="hidden" name="issueId" value={issueId} />
          <input type="hidden" name="status" value="resolved" />
          <button type="submit" className={primaryButtonClass}>
            Resolve
          </button>
        </form>
      )}
      {status !== 'ignored' && (
        <form action={setIssueStatusAction}>
          <input type="hidden" name="issueId" value={issueId} />
          <input type="hidden" name="status" value="ignored" />
          <button type="submit" className={secondaryButtonClass}>
            Ignore
          </button>
        </form>
      )}
      {status !== 'open' && (
        <form action={setIssueStatusAction}>
          <input type="hidden" name="issueId" value={issueId} />
          <input type="hidden" name="status" value="open" />
          <button type="submit" className={secondaryButtonClass}>
            Reopen
          </button>
        </form>
      )}
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex flex-col gap-1 border-line px-5 py-4 max-sm:border-b max-sm:odd:border-r">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="font-wide text-lg font-semibold tracking-tight text-ink">{value}</dd>
      {detail && <dd className="text-2xs text-ink-3 tabular">{detail}</dd>}
    </div>
  );
}

function StackPanel({ detail }: { detail: IssueDetailView }) {
  const latest: IssueEvent | undefined = detail.events[0];
  const frames = latest?.symbolicatedFrames ?? latest?.frames ?? [];
  return (
    <Panel
      title="Stack trace"
      description={
        latest
          ? `Latest event · ${formatDateTime(latest.timestamp)} UTC`
          : 'No events recorded for this issue.'
      }
      action={
        latest?.symbolicatedFrames ? (
          <HealthBadge health="good" label="Symbolicated" />
        ) : (
          <span className="text-2xs text-ink-3">Source map not found</span>
        )
      }
    >
      {frames.length === 0 ? (
        <p className="px-5 pt-3 pb-5 text-sm text-ink-2">
          This event has no stack frames. Native crashes may only carry a raw stack.
        </p>
      ) : (
        <ol className="mt-3 divide-y divide-line border-t border-line font-mono text-2xs">
          {frames.map((frame, index) => (
            <FrameRow
              // biome-ignore lint/suspicious/noArrayIndexKey: stack frames are positional and may repeat
              key={`${frame.file ?? frame.module ?? 'frame'}:${index}`}
              frame={frame}
            />
          ))}
        </ol>
      )}
      {latest?.rawStack && (
        <details className="border-t border-line px-5 py-3 text-2xs text-ink-3">
          <summary className="w-fit cursor-pointer rounded hover:text-ink-2">Raw stack</summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-line bg-night p-3 font-mono text-2xs text-ink-2">
            {latest.rawStack}
          </pre>
        </details>
      )}
    </Panel>
  );
}

function FrameRow({ frame }: { frame: Frame }) {
  const location =
    frame.file && frame.line !== undefined
      ? `${frame.file}:${frame.line}${frame.column !== undefined ? `:${frame.column}` : ''}`
      : (frame.module ?? frame.address ?? null);
  return (
    <li className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2 px-5 py-2">
      <span className="text-right text-ink-3 tabular">{frame.inApp ? '›' : ''}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink">{frame.function ?? '<anonymous>'}</span>
          {frame.inApp && <span className="text-2xs text-good">in app</span>}
          {frame.native && <span className="text-2xs text-ink-3">native</span>}
        </div>
        {location && <p className="mt-0.5 wrap-anywhere text-ink-3">{location}</p>}
      </div>
    </li>
  );
}

function OccurrencesPanel({ detail }: { detail: IssueDetailView }) {
  return (
    <Panel title="Occurrences" description="The 25 most recent events for this issue.">
      {detail.events.length === 0 ? (
        <p className="px-5 pt-3 pb-5 text-sm text-ink-2">No events recorded.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-xs">
            <thead className="border-y border-line text-ink-3">
              <tr>
                <th scope="col" className="px-5 py-2 font-medium">
                  Time
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Release
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Platform
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Environment
                </th>
                <th scope="col" className="px-5 py-2 font-medium">
                  Session
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.events.map((event) => (
                <tr key={event.id} className="border-b border-line last:border-b-0">
                  <td className="px-5 py-2.5 whitespace-nowrap text-ink-2 tabular">
                    <time dateTime={event.timestamp.toISOString()}>
                      {dateTime.format(event.timestamp)}
                    </time>
                    {event.fatal && <span className="ml-2 text-2xs text-critical">fatal</span>}
                  </td>
                  <td className="px-3 py-2.5 text-ink-2">
                    <span className="whitespace-nowrap">
                      {event.appVersion} ({event.appBuild})
                    </span>
                    {event.updateId && (
                      <span className="block font-mono text-2xs wrap-anywhere text-ink-3">
                        update {event.updateId}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-ink-2">
                    {platformLabel(event.platform)}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-ink-2">{event.environment}</td>
                  <td className="px-5 py-2.5">
                    {event.sessionId ? (
                      <Link
                        href={`/sessions?q=${encodeURIComponent(event.sessionId)}`}
                        className="font-mono text-2xs wrap-anywhere text-ink-2 hover:text-ink hover:underline"
                      >
                        {event.sessionId}
                      </Link>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
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

function BreadcrumbsPanel({ detail }: { detail: IssueDetailView }) {
  const latest = detail.events[0];
  const crumbs = latest?.breadcrumbs ?? [];
  return (
    <Panel title="Breadcrumbs" description="What happened before the latest event.">
      {crumbs.length === 0 ? (
        <p className="px-5 pt-3 pb-5 text-sm text-ink-2">No breadcrumbs on the latest event.</p>
      ) : (
        <ol className="mt-3 border-t border-line">
          {crumbs.map((crumb, index) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: breadcrumbs are chronological and may share a timestamp
              key={`${crumb.timestamp}:${index}`}
              className="grid grid-cols-[7rem_6rem_minmax(0,1fr)] gap-3 border-b border-line px-5 py-2 text-xs last:border-b-0"
            >
              <time
                dateTime={new Date(crumb.timestamp).toISOString()}
                className="text-ink-3 tabular"
              >
                {dateTime.format(new Date(crumb.timestamp))}
              </time>
              <span className="capitalize text-ink-3">{crumb.category}</span>
              <span className="min-w-0 wrap-anywhere text-ink-2" title={crumb.message}>
                {crumb.message}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function MetaPanel({ detail }: { detail: IssueDetailView }) {
  const latest = detail.events[0];
  const { issue } = detail;
  return (
    <Panel title="Details">
      <dl className="mt-3 border-t border-line text-xs">
        <MetaRow label="Project" value={issue.projectName} />
        <MetaRow label="Status" value={issue.status} />
        <MetaRow label="Origin" value={issue.origin} />
        <MetaRow label="Kind" value={issue.kind} />
        <MetaRow label="First seen" value={formatDateTime(issue.firstSeen)} />
        <MetaRow label="Last seen" value={formatDateTime(issue.lastSeen)} />
        <MetaRow label="Lifetime" value={formatElapsed(issue.firstSeen, issue.lastSeen)} />
        {issue.resolvedAt && <MetaRow label="Resolved" value={formatDateTime(issue.resolvedAt)} />}
        <MetaRow label="Fingerprint" value={issue.fingerprint} mono />
        {latest?.routeName && <MetaRow label="Route" value={latest.routeName} mono />}
        {latest?.userId && <MetaRow label="User" value={latest.userId} mono />}
        {latest?.updateId && <MetaRow label="Update" value={latest.updateId} mono />}
        {latest && <MetaRow label="OS" value={osLabel(latest.platform, latest.osVersion)} />}
        {latest && deviceLabel(latest.deviceBrand, latest.deviceModel) && (
          <MetaRow
            label="Device"
            value={deviceLabel(latest.deviceBrand, latest.deviceModel) ?? ''}
          />
        )}
      </dl>
    </Panel>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line px-5 py-2 last:border-b-0">
      <dt className="shrink-0 text-ink-3">{label}</dt>
      <dd
        className={`min-w-0 wrap-anywhere text-right text-ink-2 ${mono ? 'font-mono text-2xs' : ''}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

function ReleasesPanel({ detail }: { detail: IssueDetailView }) {
  return (
    <Panel title="Releases" description="Events per app version and build.">
      {detail.releases.length === 0 ? (
        <p className="px-5 pt-3 pb-5 text-sm text-ink-2">No release data.</p>
      ) : (
        <ul className="mt-3 border-t border-line">
          {detail.releases.map((release) => (
            <li
              key={`${release.appVersion}:${release.appBuild}`}
              className="flex items-center justify-between gap-3 border-b border-line px-5 py-2.5 text-xs last:border-b-0"
            >
              <div>
                <p className="font-medium text-ink">
                  {release.appVersion}{' '}
                  <span className="font-normal text-ink-3">({release.appBuild})</span>
                </p>
                <p className="text-2xs text-ink-3">{timeAgo(release.lastSeen, Date.now())}</p>
              </div>
              <span className="text-ink-2 tabular">{formatCount(release.events)} events</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function TagsPanel({ detail }: { detail: IssueDetailView }) {
  const tags = detail.events[0]?.tags;
  if (!tags || Object.keys(tags).length === 0) return null;
  return (
    <Panel title="Tags">
      <dl className="mt-3 border-t border-line text-xs">
        {Object.entries(tags).map(([key, value]) => (
          <MetaRow key={key} label={key} value={value} mono />
        ))}
      </dl>
    </Panel>
  );
}

function IssueSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4 px-5 py-6 sm:px-8">
      <div className="h-28 motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
      <div className="h-40 motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
      <div className="h-64 motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
    </div>
  );
}
