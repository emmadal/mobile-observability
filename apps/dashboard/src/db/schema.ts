import type { Breadcrumb, Frame } from '@mobile-observability/protocol';
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organization, user } from './auth-schema';

export * from './auth-schema';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

const createdAt = () => timestamp({ withTimezone: true }).defaultNow().notNull();
const occurredAt = () => timestamp({ withTimezone: true }).notNull();

export const apiKeyKind = pgEnum('api_key_kind', ['ingest', 'upload']);
export const issueStatus = pgEnum('issue_status', ['open', 'resolved', 'ignored']);
export const errorOrigin = pgEnum('error_origin', ['js', 'native']);
export const sessionStatus = pgEnum('session_status', ['ok', 'errored', 'crashed', 'abnormal']);
export const platform = pgEnum('platform', ['ios', 'android']);

export const projects = pgTable(
  'projects',
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    slug: text().notNull(),
    /** Kill switch served by /api/v1/config. */
    sdkEnabled: boolean().default(true).notNull(),
    sampleRate: real().default(1).notNull(),
    retentionDays: integer().default(30).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('projects_org_slug_idx').on(table.organizationId, table.slug),
    // Settings list: newest first with the keyset tiebreaker.
    index('projects_org_created_idx').on(table.organizationId, table.createdAt, table.id),
  ],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid().defaultRandom().primaryKey(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: apiKeyKind().notNull(),
    /** SHA-256 of the key; the only form used for lookups. */
    keyHash: text().notNull(),
    /** First characters, for display. */
    keyPrefix: text().notNull(),
    /** Ingest keys are public (shipped in apps) so they can be shown again; upload tokens are not stored. */
    publicKey: text(),
    createdBy: text().references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex('api_keys_hash_idx').on(table.keyHash),
    index('api_keys_project_idx').on(table.projectId),
  ],
);

export const issues = pgTable(
  'issues',
  {
    id: uuid().defaultRandom().primaryKey(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    fingerprint: text().notNull(),
    origin: errorOrigin().notNull(),
    kind: text().notNull(),
    type: text().notNull(),
    message: text().notNull(),
    /** Top in-app frame as `file:line`, or the top frame's function. */
    culprit: text(),
    status: issueStatus().default('open').notNull(),
    regressed: boolean().default(false).notNull(),
    fatal: boolean().default(false).notNull(),
    eventCount: integer().default(0).notNull(),
    firstSeen: occurredAt(),
    lastSeen: occurredAt(),
    resolvedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex('issues_project_fingerprint_idx').on(table.projectId, table.fingerprint),
    // List ordering: status filter + descending last_seen with the id tiebreaker
    // that keyset pagination seeks into.
    index('issues_project_status_last_seen_idx').on(
      table.projectId,
      table.status,
      table.lastSeen,
      table.id,
    ),
  ],
);

/** Columns shared by every telemetry table, copied from the envelope. */
const telemetryContext = () => ({
  projectId: uuid()
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  eventId: text().notNull(),
  timestamp: occurredAt(),
  receivedAt: createdAt(),
  sessionId: text(),
  installationId: text().notNull(),
  userId: text(),
  platform: platform().notNull(),
  osVersion: text(),
  deviceBrand: text(),
  deviceModel: text(),
  deviceLocale: text(),
  isEmulator: boolean(),
  appVersion: text().notNull(),
  appBuild: text().notNull(),
  updateId: text(),
  runtimeVersion: text(),
  channel: text(),
  environment: text().notNull(),
});

export const errorEvents = pgTable(
  'error_events',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    ...telemetryContext(),
    issueId: uuid()
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    origin: errorOrigin().notNull(),
    kind: text().notNull(),
    fatal: boolean().notNull(),
    handled: boolean().notNull(),
    type: text().notNull(),
    message: text().notNull(),
    frames: jsonb().$type<Frame[]>().notNull(),
    /** Frames mapped through source maps, when a map was available. */
    symbolicatedFrames: jsonb().$type<Frame[]>(),
    rawStack: text(),
    breadcrumbs: jsonb().$type<Breadcrumb[]>().notNull(),
    routeName: text(),
    tags: jsonb().$type<Record<string, string>>(),
  },
  (table) => [
    uniqueIndex('error_events_project_event_idx').on(table.projectId, table.eventId),
    // Issue detail timeline: descending timestamp with the id tiebreaker.
    index('error_events_issue_ts_idx').on(table.issueId, table.timestamp, table.id),
    index('error_events_project_ts_idx').on(table.projectId, table.timestamp),
    index('error_events_session_idx').on(table.projectId, table.sessionId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sessionId: text().notNull(),
    installationId: text().notNull(),
    userId: text(),
    status: sessionStatus().default('ok').notNull(),
    errorCount: integer().default(0).notNull(),
    startedAt: occurredAt(),
    endedAt: timestamp({ withTimezone: true }),
    lastSeenAt: occurredAt(),
    platform: platform().notNull(),
    osVersion: text(),
    deviceBrand: text(),
    deviceModel: text(),
    deviceLocale: text(),
    isEmulator: boolean(),
    appVersion: text().notNull(),
    appBuild: text().notNull(),
    updateId: text(),
    runtimeVersion: text(),
    environment: text().notNull(),
  },
  (table) => [
    uniqueIndex('sessions_project_session_idx').on(table.projectId, table.sessionId),
    // Session list ordering with the keyset tiebreaker.
    index('sessions_project_started_idx').on(table.projectId, table.startedAt, table.id),
    index('sessions_open_idx').on(table.lastSeenAt).where(sql`${table.endedAt} is null`),
  ],
);

export const metrics = pgTable(
  'metrics',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    ...telemetryContext(),
    name: text().notNull(),
    valueMs: doublePrecision().notNull(),
    routeName: text(),
    params: jsonb().$type<Record<string, unknown>>(),
  },
  (table) => [
    uniqueIndex('metrics_project_event_idx').on(table.projectId, table.eventId),
    index('metrics_project_name_ts_idx').on(table.projectId, table.name, table.timestamp),
    index('metrics_project_route_idx').on(
      table.projectId,
      table.routeName,
      table.name,
      table.timestamp,
    ),
  ],
);

export const requests = pgTable(
  'requests',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    ...telemetryContext(),
    method: text().notNull(),
    host: text().notNull(),
    path: text().notNull(),
    statusCode: smallint().notNull(),
    durationMs: doublePrecision().notNull(),
    bytesReceived: integer(),
    bytesSent: integer(),
    error: text(),
    routeName: text(),
  },
  (table) => [
    uniqueIndex('requests_project_event_idx').on(table.projectId, table.eventId),
    index('requests_project_ts_idx').on(table.projectId, table.timestamp),
    index('requests_project_endpoint_idx').on(
      table.projectId,
      table.method,
      table.host,
      table.path,
    ),
  ],
);

export const logEvents = pgTable(
  'log_events',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    ...telemetryContext(),
    name: text().notNull(),
    severity: text().notNull(),
    body: text(),
    displayName: text(),
    attributes: jsonb().$type<Record<string, unknown>>(),
  },
  (table) => [
    uniqueIndex('log_events_project_event_idx').on(table.projectId, table.eventId),
    index('log_events_project_name_ts_idx').on(table.projectId, table.name, table.timestamp),
    index('log_events_session_idx').on(table.projectId, table.sessionId),
  ],
);

/** Daily distinct endpoint templates, enforcing the cardinality cap. */
export const endpointTemplates = pgTable(
  'endpoint_templates',
  {
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    day: text().notNull(),
    endpoint: text().notNull(),
  },
  (table) => [uniqueIndex('endpoint_templates_idx').on(table.projectId, table.day, table.endpoint)],
);

export const sourceMaps = pgTable(
  'source_maps',
  {
    id: uuid().defaultRandom().primaryKey(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    platform: platform().notNull(),
    /** `update:<updateId>` or `build:<appVersion>+<build>`. */
    bundleKey: text().notNull(),
    fileName: text().notNull(),
    content: bytea().notNull(),
    sizeBytes: integer().notNull(),
    uploadedAt: createdAt(),
  },
  (table) => [
    uniqueIndex('source_maps_bundle_idx').on(table.projectId, table.platform, table.bundleKey),
  ],
);

/**
 * First-run claim: a single row, written atomically by whichever account
 * creates the workspace first, so two concurrent setups cannot both win.
 */
export const workspaceClaim = pgTable(
  'workspace_claim',
  {
    id: smallint().primaryKey().default(1),
    email: text().notNull(),
    claimedAt: createdAt(),
  },
  (table) => [check('workspace_claim_singleton', sql`${table.id} = 1`)],
);
