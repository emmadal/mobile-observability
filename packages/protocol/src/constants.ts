/** Envelope schema version written by this SDK release. */
export const CURRENT_SCHEMA_VERSION = 1;

/** The server accepts the current schema version and the one before it (AC-16). */
export function isSupportedSchemaVersion(version: unknown): boolean {
  return (
    typeof version === 'number' &&
    Number.isInteger(version) &&
    version >= 1 &&
    (version === CURRENT_SCHEMA_VERSION || version === CURRENT_SCHEMA_VERSION - 1)
  );
}

export const LIMITS = {
  maxEnvelopeBytes: 1_000_000,
  maxItemsPerEnvelope: 500,
  maxItemBytes: 64 * 1024,
  maxMessageLength: 1024,
  maxFrames: 100,
  maxBreadcrumbs: 100,
  maxRawStackLength: 32 * 1024,
  maxMetricValueMs: 60 * 60 * 1000,
} as const;

export const STARTUP_METRICS = [
  'app_startup.cold_launch_time',
  'app_startup.warm_launch_time',
  'app_startup.bundle_load_time',
  'app_startup.ttr',
  'app_startup.tti',
] as const;

export const NAVIGATION_METRICS = [
  'navigation.cold_ttr',
  'navigation.warm_ttr',
  'navigation.tti',
] as const;

export const METRIC_NAMES = [...STARTUP_METRICS, ...NAVIGATION_METRICS] as const;

export type StartupMetricName = (typeof STARTUP_METRICS)[number];
export type NavigationMetricName = (typeof NAVIGATION_METRICS)[number];
export type MetricName = (typeof METRIC_NAMES)[number];

/** Targets from the expo-observe metrics reference, in milliseconds. */
export const METRIC_TARGETS_MS: Record<StartupMetricName, number> = {
  'app_startup.cold_launch_time': 1500,
  'app_startup.warm_launch_time': 500,
  'app_startup.bundle_load_time': 300,
  'app_startup.ttr': 2000,
  'app_startup.tti': 3000,
};

export const METRIC_LABELS: Record<MetricName, string> = {
  'app_startup.cold_launch_time': 'Cold launch',
  'app_startup.warm_launch_time': 'Warm launch',
  'app_startup.bundle_load_time': 'Bundle load',
  'app_startup.ttr': 'Time to first render',
  'app_startup.tti': 'Time to interactive',
  'navigation.cold_ttr': 'Cold TTR',
  'navigation.warm_ttr': 'Warm TTR',
  'navigation.tti': 'Screen TTI',
};

export const ERROR_ORIGINS = ['js', 'native'] as const;
export type ErrorOrigin = (typeof ERROR_ORIGINS)[number];

export const ERROR_KINDS = [
  'exception',
  'promise_rejection',
  'signal',
  'native_crash',
  'anr',
  'hang',
  'oom',
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

export const SESSION_STATUSES = ['ok', 'errored', 'crashed', 'abnormal'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SEVERITIES = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const BREADCRUMB_CATEGORIES = [
  'navigation',
  'request',
  'error',
  'app_state',
  'event',
  'console',
  'user',
] as const;
export type BreadcrumbCategory = (typeof BREADCRUMB_CATEGORIES)[number];

/** Internal SDK events use this prefix and are hidden from the Events page. */
export const INTERNAL_EVENT_PREFIX = '$';

/** How an issue can be fixed: JS errors ship through an OTA update, native ones need a build. */
export type Fixability = 'ota_update' | 'new_build';

export function fixabilityFor(origin: ErrorOrigin): Fixability {
  return origin === 'js' ? 'ota_update' : 'new_build';
}

export const INGEST_PATHS = {
  envelope: '/api/v1/envelope',
  config: '/api/v1/config',
  sourcemaps: '/api/v1/sourcemaps',
} as const;

export const HEADERS = {
  apiKey: 'x-mobs-key',
  uploadToken: 'authorization',
} as const;
