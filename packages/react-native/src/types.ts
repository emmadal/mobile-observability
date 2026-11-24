import type { ItemInput, Severity } from '@mobile-observability/protocol';

/** An error event as queued by the SDK, passed to `beforeSend`. */
export type ErrorEvent = Extract<ItemInput, { type: 'error' }>;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = Record<string, JsonValue>;

export interface NavigationIntegrationOptions {
  /** Route/query param keys removed from `routeParams`; their presence also hides `url`. */
  filteredParams?: string[];
}

export interface ObserveIntegrations {
  'expo-router'?: boolean | NavigationIntegrationOptions;
  'react-navigation'?: boolean | NavigationIntegrationOptions;
}

export interface ObserveConfig {
  /** Public ingest key of the project (Settings > Keys). */
  apiKey?: string;
  /** Base URL of the dashboard, e.g. https://observability.example.com */
  endpoint?: string;
  /** Fraction of installations that report (0..1), decided once per installation. */
  sampleRate?: number;
  /** Debug builds and `__DEV__` bundles do not dispatch unless this is true. */
  dispatchInDebug?: boolean;
  /** Free-form environment tag, defaults to `process.env.NODE_ENV`. */
  environment?: string;
  /** Turns the SDK off entirely. */
  enabled?: boolean;
  integrations?: ObserveIntegrations;
  /** Capture uncaught JS errors and unhandled promise rejections (default true). */
  errorHandlingEnabled?: boolean;
  /** Report JS thread stalls over two seconds as hangs (default true). */
  hangTrackingEnabled?: boolean;
  /** JS thread stall reported as a hang (default 2000 ms). */
  hangThresholdMs?: number;
  /** Sample battery, thermal state and frame stats every N ms, 0 disables (default 300000). */
  resourceSampleIntervalMs?: number;
  /** Record fetch/XHR requests (default true). */
  networkTrackingEnabled?: boolean;
  /** Request URLs to ignore: substring or RegExp. */
  ignoreUrls?: (string | RegExp)[];
  /** A new session starts after this long in background (default 30 s). */
  sessionTimeoutMs?: number;
  /** Mutate or drop (return null) an error before it is queued. */
  beforeSend?: (event: ErrorEvent) => ErrorEvent | null;
  /** Flush interval in ms (default 10 s). */
  flushIntervalMs?: number;
}

export interface MarkInteractiveOptions {
  routeName?: string;
  params?: JsonObject;
}

export interface LogEventOptions {
  attributes?: Record<string, unknown>;
  body?: string;
  severity?: Severity;
  displayName?: string;
}

export interface CaptureContext {
  tags?: Record<string, string>;
  handled?: boolean;
}
