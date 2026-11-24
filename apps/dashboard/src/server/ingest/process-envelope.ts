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
import type { ClientContext } from './client-context';
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

function contextColumns(envelope: Envelope, projectId: string, client: ClientContext) {
  return {
    projectId,
    installationId: envelope.installationId,
    userId: envelope.user?.id ?? null,
    platform: envelope.device.platform,
    osVersion: envelope.device.osVersion,
    deviceBrand: envelope.device.manufacturer ?? null,
    deviceModel: envelope.device.model ?? null,
    deviceLocale: envelope.device.locale ?? null,
    isEmulator: envelope.device.isEmulator ?? null,
    appVersion: envelope.app.version,
    appBuild: envelope.app.build,
    updateId: envelope.app.updateId ?? null,
    runtimeVersion: envelope.app.runtimeVersion ?? null,
    channel: envelope.app.channel ?? null,
    environment: envelope.app.environment,
    clientIp: client.ip,
    clientCountry: client.country,
    clientCity: client.city,
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
  client: ClientContext = { ip: null, country: null, city: null },
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

  const context = contextColumns(envelope, project.projectId, client);
  const symbolicated = await symbolicateErrors(db, project.projectId, envelope, errors);

  await db.transaction(async (tx) => {
    for (const item of sessionItems) await upsertSession(tx, context, item, at);
    await storeErrors(tx, context, errors, symbolicated, at);
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

interface PreparedError {
  item: ErrorItem;
  frames: Frame[];
  fingerprint: string;
  occurred: Date;
}

const minDate = (dates: Date[]): Date => new Date(Math.min(...dates.map((date) => date.getTime())));
const maxDate = (dates: Date[]): Date => new Date(Math.max(...dates.map((date) => date.getTime())));

/**
 * Stores a whole batch of errors in a constant number of statements instead of
 * four per error: one upsert for all touched issues, one insert for all
 * events, one grouped UPDATE for the issue counters, one upsert for the
 * touched sessions. Semantics match the previous per-error loop:
 * duplicates (AC-14) are skipped, resolution regressions (AC-21) are detected
 * per event, and severity only moves forward.
 */
async function storeErrors(
  tx: Executor,
  context: Context,
  errors: ErrorItem[],
  symbolicated: (SymbolicatedFrame[] | null)[],
  at: (timestamp: number) => Date,
): Promise<void> {
  if (errors.length === 0) return;

  const prepared: PreparedError[] = errors.map((item, index) => {
    const frames: Frame[] = symbolicated[index] ?? item.exception.frames;
    return {
      item,
      frames,
      fingerprint: computeFingerprint(item.exception.type, frames, item.exception.message),
      occurred: at(item.timestamp),
    };
  });

  // 1. Upsert one row per distinct fingerprint; the first error of the batch
  // wins kind/type/message/culprit, exactly like the first insert used to.
  const grouped = new Map<string, PreparedError[]>();
  for (const error of prepared) {
    const bucket = grouped.get(error.fingerprint);
    if (bucket) bucket.push(error);
    else grouped.set(error.fingerprint, [error]);
  }

  const issueRows = await tx
    .insert(issues)
    .values(
      [...grouped.values()].map((bucket) => {
        const first = bucket[0];
        if (!first) throw new Error('Empty fingerprint bucket');
        return {
          projectId: context.projectId,
          fingerprint: first.fingerprint,
          origin: first.item.origin,
          kind: first.item.kind,
          type: first.item.exception.type,
          message: first.item.exception.message,
          culprit: culpritOf(first.frames),
          fatal: bucket.some((error) => error.item.fatal),
          eventCount: 0,
          firstSeen: minDate(bucket.map((error) => error.occurred)),
          lastSeen: maxDate(bucket.map((error) => error.occurred)),
        };
      }),
    )
    .onConflictDoUpdate({
      target: [issues.projectId, issues.fingerprint],
      // No-op update so RETURNING yields the existing row.
      set: { projectId: sql`${issues.projectId}` },
    })
    .returning({ id: issues.id, fingerprint: issues.fingerprint });
  const issueIdByFingerprint = new Map(issueRows.map((row) => [row.fingerprint, row.id]));

  // 2. Insert every event; RETURNING tells us which deliveries were new.
  const eventRows = await tx
    .insert(errorEvents)
    .values(
      prepared.map((error, index) => ({
        ...context,
        issueId: issueIdByFingerprint.get(error.fingerprint) as string,
        eventId: error.item.eventId,
        timestamp: error.occurred,
        sessionId: error.item.sessionId ?? null,
        origin: error.item.origin,
        kind: error.item.kind,
        fatal: error.item.fatal,
        handled: error.item.handled,
        type: error.item.exception.type,
        message: error.item.exception.message,
        frames: error.item.exception.frames,
        symbolicatedFrames: symbolicated[index] ?? null,
        rawStack: error.item.rawStack ?? null,
        breadcrumbs: error.item.breadcrumbs,
        routeName: error.item.routeName ?? null,
        tags: error.item.tags ?? null,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: errorEvents.id, eventId: errorEvents.eventId });
  if (eventRows.length === 0) return; // everything was a duplicate (AC-14)

  const delivered = new Set(eventRows.map((row) => row.eventId));
  await applyIssueDeltas(tx, context, grouped, delivered);
  await upsertErrorSessions(
    tx,
    context,
    prepared.filter((e) => delivered.has(e.item.eventId)),
  );
}

/** Applies aggregated event deltas to all touched issues in a single statement. */
async function applyIssueDeltas(
  tx: Executor,
  context: Context,
  grouped: Map<string, PreparedError[]>,
  delivered: Set<string>,
): Promise<void> {
  const deltas = [...grouped.entries()]
    .map(([fingerprint, bucket]) => {
      const fresh = bucket.filter((error) => delivered.has(error.item.eventId));
      if (fresh.length === 0) return null;
      return {
        fingerprint,
        count: fresh.length,
        maxOccurred: maxDate(fresh.map((error) => error.occurred)),
        fatal: fresh.some((error) => error.item.fatal),
      };
    })
    .filter((delta): delta is NonNullable<typeof delta> => delta !== null);
  if (deltas.length === 0) return;

  // A new event after resolution reopens the issue as a regression (AC-21);
  // `max_occurred > resolved_at` is equivalent to checking every event.
  // Dates are passed as ISO strings and cast explicitly: postgres.js does not
  // serialize untyped Date params inside raw SQL.
  const rows = sql.join(
    deltas.map(
      (delta) =>
        sql`(${delta.fingerprint}, ${delta.count}::int, ${delta.maxOccurred.toISOString()}::timestamptz, ${delta.fatal}::boolean)`,
    ),
    sql`, `,
  );
  await tx.execute(sql`
    update ${issues} set
      event_count = ${issues.eventCount} + v.event_count,
      last_seen = greatest(${issues.lastSeen}, v.max_occurred),
      first_seen = least(${issues.firstSeen}, v.max_occurred),
      fatal = ${issues.fatal} or v.fatal,
      regressed = ${issues.regressed} or (${issues.status} = 'resolved' and v.max_occurred > ${issues.resolvedAt}),
      resolved_at = case when ${issues.status} = 'resolved' and v.max_occurred > ${issues.resolvedAt}
        then null else ${issues.resolvedAt} end,
      status = case when ${issues.status} = 'resolved' and v.max_occurred > ${issues.resolvedAt}
        then 'open'::issue_status else ${issues.status} end
    from (values ${rows}) as v(fingerprint, event_count, max_occurred, fatal)
    where ${issues.projectId} = ${context.projectId} and ${issues.fingerprint} = v.fingerprint
  `);
}

/** Fatal errors crash their session; others mark it errored (creating it if unseen). */
async function upsertErrorSessions(
  tx: Executor,
  context: Context,
  fresh: PreparedError[],
): Promise<void> {
  const bySession = new Map<string, PreparedError[]>();
  for (const error of fresh) {
    const sessionId = error.item.sessionId;
    if (!sessionId) continue;
    const bucket = bySession.get(sessionId);
    if (bucket) bucket.push(error);
    else bySession.set(sessionId, [error]);
  }
  if (bySession.size === 0) return;

  await tx
    .insert(sessions)
    .values(
      [...bySession.entries()].map(([sessionId, bucket]) => {
        const fatal = bucket.some((error) => error.item.fatal);
        const occurred = bucket.map((error) => error.occurred);
        return {
          projectId: context.projectId,
          sessionId,
          installationId: context.installationId,
          userId: context.userId,
          status: (fatal ? 'crashed' : 'errored') as 'crashed' | 'errored',
          errorCount: bucket.length,
          startedAt: minDate(occurred),
          lastSeenAt: maxDate(occurred),
          platform: context.platform,
          osVersion: context.osVersion,
          deviceBrand: context.deviceBrand,
          deviceModel: context.deviceModel,
          deviceLocale: context.deviceLocale,
          isEmulator: context.isEmulator,
          clientIp: context.clientIp,
          clientCountry: context.clientCountry,
          clientCity: context.clientCity,
          appVersion: context.appVersion,
          appBuild: context.appBuild,
          updateId: context.updateId,
          runtimeVersion: context.runtimeVersion,
          environment: context.environment,
          // A fatal error ends the session at its first occurrence in the batch.
          ...(fatal
            ? {
                endedAt: minDate(
                  bucket.filter((error) => error.item.fatal).map((error) => error.occurred),
                ),
              }
            : {}),
        };
      }),
    )
    .onConflictDoUpdate({
      target: [sessions.projectId, sessions.sessionId],
      set: {
        status: sql`case
          when excluded.status = 'crashed' then 'crashed'::session_status
          when ${sessions.status} = 'ok' then 'errored'::session_status
          else ${sessions.status} end`,
        errorCount: sql`${sessions.errorCount} + excluded.error_count`,
        lastSeenAt: sql`greatest(${sessions.lastSeenAt}, excluded.last_seen_at)`,
        endedAt: sql`coalesce(${sessions.endedAt}, excluded.ended_at)`,
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
      deviceBrand: context.deviceBrand,
      deviceModel: context.deviceModel,
      deviceLocale: context.deviceLocale,
      isEmulator: context.isEmulator,
      clientIp: context.clientIp,
      clientCountry: context.clientCountry,
      clientCity: context.clientCity,
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
