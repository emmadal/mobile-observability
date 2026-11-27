import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { HealthBadge, PageHeader, Panel } from '@/components/ui';
import { MAX_EVENT_ATTRIBUTE_LENGTH, singleParam } from '@/features/events/filters';
import { parseOverviewFilters, toSearchParams } from '@/features/overview/filters';
import { OverviewFrame } from '@/features/overview/overview-frame';
import { getFilterOptions } from '@/features/overview/service';
import { OverviewToolbar } from '@/features/overview/toolbar';
import { getOrgContext } from '@/features/projects/access';
import { formatCount, formatDateTime, formatPercent, timeAgo } from '@/features/telemetry/format';
import { getUserDetail } from '@/features/users/service';

export const metadata = { title: 'User' };

export default function UserDetailPage({ searchParams }: PageProps<'/users/detail'>) {
  return (
    <Suspense fallback={<UserSkeleton />}>
      <UserContent searchParams={searchParams} />
    </Suspense>
  );
}

async function UserContent({ searchParams }: Pick<PageProps<'/users/detail'>, 'searchParams'>) {
  const context = await getOrgContext();
  if (!context) {
    return (
      <div className="px-5 py-8 sm:px-8">
        <p className="text-sm text-ink-2">This account is not part of a workspace yet.</p>
      </div>
    );
  }

  const params = await searchParams;
  const userId = singleParam(params.id, MAX_EVENT_ATTRIBUTE_LENGTH);
  if (!userId) notFound();

  const now = new Date();
  const parsed = parseOverviewFilters(params, now);
  const options = await getFilterOptions(context.organizationId);
  if (options.projects.length === 0) notFound();
  const filters = options.projects.some((project) => project.id === parsed.project)
    ? parsed
    : { ...parsed, project: null };

  // The profile spans all time so an inactive user keeps its history.
  const user = await getUserDetail(context.organizationId, userId);
  if (!user) notFound();
  const crashFreeRate = user.sessions > 0 ? 1 - user.crashedSessions / user.sessions : null;

  return (
    <OverviewFrame
      filters={filters}
      toolbar={<OverviewToolbar options={options} asOf={now.toISOString()} />}
    >
      <div className="flex flex-col gap-4 px-5 py-6 sm:px-8">
        <PageHeader
          title={user.phone ?? userId}
          description={
            <span className="flex flex-wrap items-center gap-2">
              {user.segment && (
                <>
                  <span className="rounded bg-raised px-1.5 text-2xs font-medium text-ink-2 uppercase">
                    {user.segment}
                  </span>
                  <span aria-hidden="true">·</span>
                </>
              )}
              {user.phone && (
                <>
                  <span className="font-mono text-xs">Phone {user.phone}</span>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <span className="font-mono text-xs">{userId}</span>
              <span aria-hidden="true">·</span>
              <span>{formatCount(user.sessions)} sessions, all time</span>
            </span>
          }
          aside={
            <Link href={`/users?${toSearchParams(filters).toString()}`} className="hover:text-ink">
              ← Back to users
            </Link>
          }
        />

        <Panel>
          <dl className="grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
            <Stat label="Sessions" value={formatCount(user.sessions)} detail="All time" />
            <Stat
              label="Crash-free sessions"
              value={crashFreeRate === null ? 'No data' : formatPercent(crashFreeRate)}
              detail={`${formatCount(user.crashedSessions)} crashed`}
            />
            <Stat label="Errors" value={formatCount(user.errors)} detail="All time" />
            <Stat label="Events" value={formatCount(user.events)} detail="Observe.logEvent calls" />
            <Stat
              label="First seen"
              value={user.firstSeen ? formatDateTime(user.firstSeen) : '—'}
              detail={user.firstSeen ? timeAgo(user.firstSeen, now.getTime()) : 'No data'}
            />
            <Stat
              label="Last seen"
              value={user.lastSeen ? formatDateTime(user.lastSeen) : '—'}
              detail={user.lastSeen ? timeAgo(user.lastSeen, now.getTime()) : 'No data'}
            />
          </dl>
        </Panel>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="Projects" description="Where this user was seen.">
            {user.projects.length === 0 ? (
              <p className="px-5 pt-3 pb-5 text-sm text-ink-2">No sessions recorded.</p>
            ) : (
              <ul className="mt-3 border-t border-line">
                {user.projects.map((project) => (
                  <li
                    key={project.id}
                    className="flex items-center justify-between gap-3 border-b border-line px-5 py-2.5 text-xs last:border-b-0"
                  >
                    <Link
                      href={`/sessions?${new URLSearchParams({
                        range: '30d',
                        project: project.id,
                        q: userId,
                      }).toString()}`}
                      className="wrap-anywhere font-medium text-ink hover:underline"
                    >
                      {project.name}
                    </Link>
                    <span className="text-ink-3 tabular">{formatCount(project.sessions)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Devices" description="Every device this user was seen on.">
            {user.devices.length === 0 ? (
              <p className="px-5 pt-3 pb-5 text-sm text-ink-2">
                No device information reported by the SDK.
              </p>
            ) : (
              <ul className="mt-3 flex flex-wrap gap-2 border-t border-line px-5 py-4">
                {user.devices.map((device) => (
                  <li
                    key={device}
                    className="rounded-full bg-raised px-3 py-1 text-xs text-ink-2 ring-1 ring-line ring-inset"
                  >
                    {device}
                  </li>
                ))}
              </ul>
            )}
            {crashFreeRate !== null && crashFreeRate < 0.98 && (
              <p className="border-t border-line px-5 py-3">
                <HealthBadge health="critical" label="Frequent crashes on this user's devices" />
              </p>
            )}
          </Panel>
        </div>
      </div>
    </OverviewFrame>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="flex flex-col gap-1 border-line px-5 py-4 max-sm:border-b max-sm:odd:border-r">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="font-wide text-sm font-semibold tracking-tight text-ink">{value}</dd>
      <dd className="wrap-anywhere text-2xs text-ink-3" title={detail}>
        {detail}
      </dd>
    </div>
  );
}

function UserSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4 px-5 py-6 sm:px-8">
      <div className="h-24 motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
      <div className="h-40 motion-safe:animate-pulse rounded-[10px] border border-line bg-panel" />
    </div>
  );
}
