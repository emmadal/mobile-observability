import {
  type Envelope,
  type ErrorItem,
  type EventItem,
  type Frame,
  type MetricItem,
  type RequestItem,
  type SessionItem,
  sanitizeUrl,
} from '@mobile-observability/protocol';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '@/db/client';
import {
  endpointTemplates,
  errorEvents,
  issues,
  logEvents,
  metrics,
  requests,
  sessions,
} from '@/db/schema';
import type { ResolvedProject } from '../keys/resolve';
import { findSourceMap } from '../symbolication/store';
import {
  bundleKeysFor,
  MAX_SYMBOLICATED_FRAMES_PER_ENVELOPE,
  type SymbolicatedFrame,
  symbolicateFrames,
} from '../symbolication/symbolicator';
import { computeFingerprint, culpritOf } from './fingerprint';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

export const CLOCK_SKEW_THRESHOLD_MS = 60_000;
export const MAX_ENDPOINT_TEMPLATES_PER_DAY = 2_000;
const DAY_MS = 86_400_000;

export interface IngestResult {
  accepted: number;
  dropped: number;
}

/** Shifts device timestamps when the device clock is off by more than a minute (AC-15). */
export function clockSkewOffset(sentAt: number, receivedAt: number): number {
  const skew = receivedAt - sentAt;
  return Math.abs(skew) > CLOCK_SKEW_THRESHOLD_MS ? skew : 0;
}

function contextColumns(envelope: Envelope, projectId: string) {
  return {
    projectId,
    installationId: envelope.installationId,
    userId: envelope.user?.id ?? null,
    platform: envelope.device.platform,
    osVersion: envelope.device.osVersion,
    deviceModel: envelope.device.model ?? null,
    appVersion: envelope.app.version,
    appBuild: envelope.app.build,
    updateId: envelope.app.updateId ?? null,
    runtimeVersion: envelope.app.runtimeVersion ?? null,
    channel: envelope.app.channel ?? null,
    environment: envelope.app.environment,
  };
}

/**
 * Stores one validated envelope: errors are symbolicated, grouped into issues
 * and attached to sessions; metrics, requests and events are inserted. All
 * inserts are idempotent on (project, eventId) so client retries are safe.
 */
export async function processEnvelope(
  db: Database,
  project: ResolvedProject,
  envelope: Envelope,
  receivedAt: number,
): Promise<IngestResult> {
  const offset = clockSkewOffset(envelope.sentAt, receivedAt);
  const oldest = receivedAt - project.retentionDays * DAY_MS;
  const newest = receivedAt + DAY_MS;
  const at = (timestamp: number) => new Date(timestamp + offset);
  const inWindow = (timestamp: number) =>
    timestamp + offset >= oldest && timestamp + offset <= newest;

  const errors: ErrorItem[] = [];
  const sessionItems: SessionItem[] = [];
  const metricItems: MetricItem[] = [];
  const requestItems: RequestItem[] = [];
  const eventItems: EventItem[] = [];
  let dropped = 0;

  for (const item of envelope.items) {
    const timestamp = item.type === 'session' ? item.startedAt : item.timestamp;
    if (!inWindow(timestamp)) {
      dropped += 1;
      continue;
    }
    if (item.type === 'error') errors.push(item);
    else if (item.type === 'session') sessionItems.push(item);
    else if (item.type === 'metric') metricItems.push(item);
    else if (item.type === 'request') requestItems.push(item);
    else eventItems.push(item);
  }

  const context = contextColumns(envelope, project.projectId);
  const symbolicated = await symbolicateErrors(db, project.projectId, envelope, errors);

  await db.transaction(async (tx) => {
    for (const item of sessionItems) await upsertSession(tx, context, item, at);
    for (const [index, item] of errors.entries()) {
      await storeError(tx, context, item, symbolicated[index] ?? null, at);
    }
    if (metricItems.length > 0) {
      await tx
        .insert(metrics)
        .values(
          metricItems.map((item) => ({
            ...context,
            eventId: item.eventId,
            timestamp: at(item.timestamp),
            sessionId: item.sessionId ?? null,
            name: item.name,
            valueMs: item.valueMs,
            routeName: item.routeName ?? null,
            params: item.params ?? null,
          })),
        )
        .onConflictDoNothing();
    }
    if (requestItems.length > 0) await storeRequests(tx, context, requestItems, at, receivedAt);
    if (eventItems.length > 0) {
      await tx
        .insert(logEvents)
        .values(
          eventItems.map((item) => ({
            ...context,
            eventId: item.eventId,
            timestamp: at(item.timestamp),
            sessionId: item.sessionId ?? null,
            name: item.name,
            severity: item.severity,
            body: item.body ?? null,
            displayName: item.displayName ?? null,
            attributes: item.attributes ?? null,
          })),
        )
        .onConflictDoNothing();
    }
  });

  return { accepted: envelope.items.length - dropped, dropped };
}

async function symbolicateErrors(
  db: Database,
  projectId: string,
  envelope: Envelope,
  errors: ErrorItem[],
): Promise<(SymbolicatedFrame[] | null)[]> {
  const needsMap = errors.some(
    (error) => error.origin === 'js' && error.exception.frames.length > 0,
  );
  if (!needsMap) return errors.map(() => null);
  const loaded = await findSourceMap(
    db,
    projectId,
    envelope.device.platform,
    bundleKeysFor(envelope.app),
  );
  if (!loaded) return errors.map(() => null);
  let budget = MAX_SYMBOLICATED_FRAMES_PER_ENVELOPE;
  return errors.map((error) => {
    if (error.origin !== 'js' || budget < error.exception.frames.length) return null;
    budget -= error.exception.frames.length;
    return symbolicateFrames(error.exception.frames, loaded);
  });
}

type Context = ReturnType<typeof contextColumns>;

async function storeError(
  tx: Executor,
  context: Context,
  item: ErrorItem,
  symbolicatedFrames: SymbolicatedFrame[] | null,
  at: (timestamp: number) => Date,
): Promise<void> {
  const frames: Frame[] = symbolicatedFrames ?? item.exception.frames;
  const fingerprint = computeFingerprint(item.exception.type, frames, item.exception.message);
  const occurred = at(item.timestamp);

  const [issue] = await tx
    .insert(issues)
    .values({
      projectId: context.projectId,
      fingerprint,
      origin: item.origin,
      kind: item.kind,
      type: item.exception.type,
      message: item.exception.message,
      culprit: culpritOf(frames),
      fatal: item.fatal,
      eventCount: 0,
      firstSeen: occurred,
      lastSeen: occurred,
    })
    .onConflictDoUpdate({
      target: [issues.projectId, issues.fingerprint],
      // No-op update so RETURNING yields the existing row.
      set: { projectId: sql`${issues.projectId}` },
    })
    .returning({ id: issues.id });
  if (!issue) return;

  const inserted = await tx
    .insert(errorEvents)
    .values({
      ...context,
      issueId: issue.id,
      eventId: item.eventId,
      timestamp: occurred,
      sessionId: item.sessionId ?? null,
      origin: item.origin,
      kind: item.kind,
      fatal: item.fatal,
      handled: item.handled,
      type: item.exception.type,
      message: item.exception.message,
      frames: item.exception.frames,
      symbolicatedFrames,
      rawStack: item.rawStack ?? null,
      breadcrumbs: item.breadcrumbs,
      routeName: item.routeName ?? null,
      tags: item.tags ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: errorEvents.id });
  if (inserted.length === 0) return; // duplicate delivery (AC-14)

  // Untyped Date params are not serialized by postgres.js inside raw SQL; cast explicitly.
  const when = sql`${occurred.toISOString()}::timestamptz`;
  // A new event after resolution reopens the issue as a regression (AC-21).
  await tx
    .update(issues)
    .set({
      eventCount: sql`${issues.eventCount} + 1`,
      lastSeen: sql`greatest(${issues.lastSeen}, ${when})`,
      firstSeen: sql`least(${issues.firstSeen}, ${when})`,
      fatal: sql`${issues.fatal} or ${item.fatal}`,
      regressed: sql`${issues.regressed} or (${issues.status} = 'resolved' and ${when} > ${issues.resolvedAt})`,
      resolvedAt: sql`case when ${issues.status} = 'resolved' and ${when} > ${issues.resolvedAt} then null else ${issues.resolvedAt} end`,
      status: sql`case when ${issues.status} = 'resolved' and ${when} > ${issues.resolvedAt} then 'open'::issue_status else ${issues.status} end`,
    })
    .where(eq(issues.id, issue.id));

  if (item.sessionId) await markSessionErrored(tx, context, item, occurred);
}

/** Fatal errors crash their session; others mark it errored (creating it if unseen). */
async function markSessionErrored(tx: Executor, context: Context, item: ErrorItem, occurred: Date) {
  const when = sql`${occurred.toISOString()}::timestamptz`;
  const status = item.fatal ? 'crashed' : 'errored';
  await tx
    .insert(sessions)
    .values({
      projectId: context.projectId,
      sessionId: item.sessionId as string,
      installationId: context.installationId,
      userId: context.userId,
      status,
      errorCount: 1,
      startedAt: occurred,
      lastSeenAt: occurred,
      platform: context.platform,
      osVersion: context.osVersion,
      deviceModel: context.deviceModel,
      appVersion: context.appVersion,
      appBuild: context.appBuild,
      updateId: context.updateId,
      runtimeVersion: context.runtimeVersion,
      environment: context.environment,
      ...(item.fatal ? { endedAt: occurred } : {}),
    })
    .onConflictDoUpdate({
      target: [sessions.projectId, sessions.sessionId],
      set: {
        status: item.fatal
          ? sql`'crashed'::session_status`
          : sql`case when ${sessions.status} = 'ok' then 'errored'::session_status else ${sessions.status} end`,
        errorCount: sql`${sessions.errorCount} + 1`,
        lastSeenAt: sql`greatest(${sessions.lastSeenAt}, ${when})`,
        ...(item.fatal ? { endedAt: sql`coalesce(${sessions.endedAt}, ${when})` } : {}),
      },
    });
}

async function upsertSession(
  tx: Executor,
  context: Context,
  item: SessionItem,
  at: (timestamp: number) => Date,
): Promise<void> {
  const startedAt = at(item.startedAt);
  const endedAt = item.endedAt !== undefined ? at(item.endedAt) : null;
  const lastSeenAt = endedAt ?? startedAt;
  await tx
    .insert(sessions)
    .values({
      projectId: context.projectId,
      sessionId: item.sessionId,
      installationId: context.installationId,
      userId: context.userId,
      status: item.status,
      errorCount: item.errorCount,
      startedAt,
      endedAt,
      lastSeenAt,
      platform: context.platform,
      osVersion: context.osVersion,
      deviceModel: context.deviceModel,
      appVersion: context.appVersion,
      appBuild: context.appBuild,
      updateId: context.updateId,
      runtimeVersion: context.runtimeVersion,
      environment: context.environment,
    })
    .onConflictDoUpdate({
      target: [sessions.projectId, sessions.sessionId],
      set: {
        // Severity only moves forward: ok < errored < crashed.
        status: sql`case
          when ${sessions.status} = 'crashed' or excluded.status = 'crashed' then 'crashed'::session_status
          when ${sessions.status} = 'errored' or excluded.status = 'errored' then 'errored'::session_status
          else excluded.status end`,
        errorCount: sql`greatest(${sessions.errorCount}, excluded.error_count)`,
        startedAt: sql`least(${sessions.startedAt}, excluded.started_at)`,
        endedAt: sql`coalesce(excluded.ended_at, ${sessions.endedAt})`,
        lastSeenAt: sql`greatest(${sessions.lastSeenAt}, excluded.last_seen_at)`,
      },
    });
}

async function storeRequests(
  tx: Executor,
  context: Context,
  items: RequestItem[],
  at: (timestamp: number) => Date,
  receivedAt: number,
): Promise<void> {
  const day = new Date(receivedAt).toISOString().slice(0, 10);
  // Defense in depth (AC-31): re-sanitize even though the SDK already did.
  const sanitized = items.map((item) => {
    const { host, path } = sanitizeUrl(
      `https://${item.host}${item.path.startsWith('/') ? '' : '/'}${item.path}`,
    );
    return { item, host, path, endpoint: `${item.method} ${host}${path}` };
  });

  const endpoints = [...new Set(sanitized.map((entry) => entry.endpoint))];
  const known = await tx
    .select({ endpoint: endpointTemplates.endpoint })
    .from(endpointTemplates)
    .where(
      and(
        eq(endpointTemplates.projectId, context.projectId),
        eq(endpointTemplates.day, day),
        inArray(endpointTemplates.endpoint, endpoints),
      ),
    );
  const allowed = new Set(known.map((row) => row.endpoint));
  const [{ count } = { count: 0 }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(endpointTemplates)
    .where(and(eq(endpointTemplates.projectId, context.projectId), eq(endpointTemplates.day, day)));
  let budget = MAX_ENDPOINT_TEMPLATES_PER_DAY - count;
  const fresh: string[] = [];
  for (const endpoint of endpoints) {
    if (allowed.has(endpoint) || budget <= 0) continue;
    allowed.add(endpoint);
    fresh.push(endpoint);
    budget -= 1;
  }
  if (fresh.length > 0) {
    await tx
      .insert(endpointTemplates)
      .values(fresh.map((endpoint) => ({ projectId: context.projectId, day, endpoint })))
      .onConflictDoNothing();
  }

  await tx
    .insert(requests)
    .values(
      sanitized.map(({ item, host, path, endpoint }) => ({
        ...context,
        eventId: item.eventId,
        timestamp: at(item.timestamp),
        sessionId: item.sessionId ?? null,
        method: item.method,
        host,
        // Over the daily cardinality cap, new endpoints collapse into one bucket.
        path: allowed.has(endpoint) ? path : '/:other',
        statusCode: item.statusCode,
        durationMs: item.durationMs,
        bytesReceived: item.bytesReceived ?? null,
        bytesSent: item.bytesSent ?? null,
        error: item.error ?? null,
        routeName: item.routeName ?? null,
      })),
    )
    .onConflictDoNothing();
}
