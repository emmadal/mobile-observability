import { z } from 'zod';
import {
  BREADCRUMB_CATEGORIES,
  ERROR_KINDS,
  ERROR_ORIGINS,
  isSupportedSchemaVersion,
  LIMITS,
  METRIC_NAMES,
  SESSION_STATUSES,
  SEVERITIES,
} from './constants.js';

const truncated = (max: number) => z.string().transform((value) => value.slice(0, max));
const id = z.string().min(1).max(64);
const epochMs = z.number().int().nonnegative();
const jsonRecord = z.record(z.string().max(128), z.json());

export const frameSchema = z.object({
  function: truncated(256).optional(),
  file: truncated(512).optional(),
  line: z.number().int().nonnegative().optional(),
  column: z.number().int().nonnegative().optional(),
  inApp: z.boolean().optional(),
  native: z.boolean().optional(),
  /** Binary image (iOS) or package (Android) for native frames. */
  module: truncated(256).optional(),
  address: truncated(32).optional(),
});

export const breadcrumbSchema = z.object({
  timestamp: epochMs,
  category: z.enum(BREADCRUMB_CATEGORIES),
  message: truncated(LIMITS.maxMessageLength),
  level: z.enum(['debug', 'info', 'warning', 'error']).optional(),
  data: jsonRecord.optional(),
});

const itemBase = {
  eventId: id,
  timestamp: epochMs,
  sessionId: id.optional(),
};

export const errorItemSchema = z.object({
  type: z.literal('error'),
  ...itemBase,
  origin: z.enum(ERROR_ORIGINS),
  kind: z.enum(ERROR_KINDS),
  fatal: z.boolean(),
  handled: z.boolean(),
  exception: z.object({
    type: truncated(256),
    message: truncated(LIMITS.maxMessageLength),
    frames: z.array(frameSchema).transform((frames) => frames.slice(0, LIMITS.maxFrames)),
  }),
  rawStack: truncated(LIMITS.maxRawStackLength).optional(),
  breadcrumbs: z
    .array(breadcrumbSchema)
    .default([])
    .transform((crumbs) => crumbs.slice(-LIMITS.maxBreadcrumbs)),
  routeName: truncated(256).optional(),
  tags: z.record(z.string().max(64), truncated(256)).optional(),
});

export const sessionItemSchema = z.object({
  type: z.literal('session'),
  sessionId: id,
  startedAt: epochMs,
  endedAt: epochMs.optional(),
  status: z.enum(SESSION_STATUSES),
  errorCount: z.number().int().nonnegative(),
  /** True for the first update of a session. */
  init: z.boolean(),
});

export const metricItemSchema = z.object({
  type: z.literal('metric'),
  ...itemBase,
  name: z.enum(METRIC_NAMES),
  valueMs: z.number().nonnegative().max(LIMITS.maxMetricValueMs),
  routeName: truncated(256).optional(),
  params: jsonRecord.optional(),
});

export const requestItemSchema = z.object({
  type: z.literal('request'),
  ...itemBase,
  method: z
    .string()
    .max(16)
    .transform((method) => method.toUpperCase()),
  host: truncated(255),
  path: truncated(1024),
  statusCode: z.number().int().min(0).max(599),
  durationMs: z.number().nonnegative(),
  bytesReceived: z.number().int().nonnegative().optional(),
  bytesSent: z.number().int().nonnegative().optional(),
  error: truncated(256).optional(),
  routeName: truncated(256).optional(),
});

export const eventItemSchema = z.object({
  type: z.literal('event'),
  ...itemBase,
  name: z.string().min(1).max(128),
  severity: z.enum(SEVERITIES).default('info'),
  body: truncated(4096).optional(),
  displayName: truncated(128).optional(),
  attributes: jsonRecord.optional(),
});

const itemSchemas = {
  error: errorItemSchema,
  session: sessionItemSchema,
  metric: metricItemSchema,
  request: requestItemSchema,
  event: eventItemSchema,
} as const;

export type ItemType = keyof typeof itemSchemas;
export const ITEM_TYPES = Object.keys(itemSchemas) as ItemType[];

export const itemSchema = z.discriminatedUnion('type', [
  errorItemSchema,
  sessionItemSchema,
  metricItemSchema,
  requestItemSchema,
  eventItemSchema,
]);

export const appContextSchema = z.object({
  version: z.string().min(1).max(64),
  build: z.string().min(1).max(64),
  bundleId: z.string().max(255).optional(),
  runtimeVersion: z.string().max(128).optional(),
  updateId: z.string().max(64).optional(),
  channel: z.string().max(64).optional(),
  isEmbeddedLaunch: z.boolean().optional(),
  environment: z.string().max(64).default('production'),
});

export const deviceContextSchema = z.object({
  platform: z.enum(['ios', 'android']),
  osVersion: z.string().max(64),
  model: z.string().max(128).optional(),
  manufacturer: z.string().max(128).optional(),
  isEmulator: z.boolean().optional(),
  locale: z.string().max(32).optional(),
});

const envelopeHeaderSchema = z.object({
  schemaVersion: z.number().int(),
  sentAt: epochMs,
  sdk: z.object({ name: z.string().max(128), version: z.string().max(64) }),
  installationId: id,
  app: appContextSchema,
  device: deviceContextSchema,
  user: z.object({ id: z.string().min(1).max(128) }).optional(),
});

export const envelopeSchema = envelopeHeaderSchema.extend({
  items: z.array(itemSchema).max(LIMITS.maxItemsPerEnvelope),
});

export type Frame = z.output<typeof frameSchema>;
export type Breadcrumb = z.output<typeof breadcrumbSchema>;
export type ErrorItem = z.output<typeof errorItemSchema>;
export type SessionItem = z.output<typeof sessionItemSchema>;
export type MetricItem = z.output<typeof metricItemSchema>;
export type RequestItem = z.output<typeof requestItemSchema>;
export type EventItem = z.output<typeof eventItemSchema>;
export type Item = z.output<typeof itemSchema>;
export type AppContext = z.output<typeof appContextSchema>;
export type DeviceContext = z.output<typeof deviceContextSchema>;
export type Envelope = z.output<typeof envelopeSchema>;

/** Shapes the SDK writes (before server-side defaults and truncation). */
export type FrameInput = z.input<typeof frameSchema>;
export type BreadcrumbInput = z.input<typeof breadcrumbSchema>;
export type ItemInput = z.input<typeof itemSchema>;
export type AppContextInput = z.input<typeof appContextSchema>;
export type DeviceContextInput = z.input<typeof deviceContextSchema>;
export type EnvelopeInput = z.input<typeof envelopeSchema>;

export interface SchemaIssue {
  path: string;
  message: string;
}

export type ParseEnvelopeResult =
  | { ok: true; envelope: Envelope; droppedItems: number }
  | { ok: false; issues: SchemaIssue[] };

const toIssues = (error: z.ZodError, prefix: (string | number)[] = []): SchemaIssue[] =>
  error.issues.map((issue) => ({
    path: [...prefix, ...issue.path.map(String)].join('.'),
    message: issue.message,
  }));

function isKnownItemType(value: unknown): value is { type: ItemType } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string' &&
    value.type in itemSchemas
  );
}

/**
 * Validates an envelope. Unknown fields are stripped, items of unknown type are
 * dropped and counted (forward compatibility), and any invalid known item rejects
 * the whole envelope with field paths (AC-13, AC-16).
 */
export function parseEnvelope(input: unknown): ParseEnvelopeResult {
  const header = envelopeHeaderSchema
    .extend({ items: z.array(z.unknown()).max(LIMITS.maxItemsPerEnvelope) })
    .safeParse(input);
  if (!header.success) return { ok: false, issues: toIssues(header.error) };

  if (!isSupportedSchemaVersion(header.data.schemaVersion)) {
    return {
      ok: false,
      issues: [{ path: 'schemaVersion', message: 'Unsupported schema version' }],
    };
  }

  const items: Item[] = [];
  const issues: SchemaIssue[] = [];
  let droppedItems = 0;

  header.data.items.forEach((raw, index) => {
    if (!isKnownItemType(raw)) {
      droppedItems += 1;
      return;
    }
    const parsed = itemSchemas[raw.type].safeParse(raw);
    if (parsed.success) items.push(parsed.data);
    else issues.push(...toIssues(parsed.error, ['items', index]));
  });

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, envelope: { ...header.data, items }, droppedItems };
}
