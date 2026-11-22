import { getClient } from './core/singleton';
import type {
  CaptureContext,
  LogEventOptions,
  MarkInteractiveOptions,
  ObserveConfig,
} from './types';

export { ObserveErrorBoundary, type ObserveErrorBoundaryProps } from './react/ObserveErrorBoundary';
export {
  ObserveInteractiveMarker,
  type ObserveInteractiveMarkerProps,
} from './react/ObserveInteractiveMarker';
export { ObserveRoot } from './react/ObserveRoot';
export { type UseObserveResult, useObserve } from './react/useObserve';
export type {
  CaptureContext,
  ErrorEvent,
  JsonObject,
  JsonValue,
  LogEventOptions,
  MarkInteractiveOptions,
  NavigationIntegrationOptions,
  ObserveConfig,
  ObserveIntegrations,
} from './types';

/** Imperative API, mirroring `Observe` from expo-observe plus crash-reporting additions. */
export const Observe = {
  /** Configure at module scope, before ObserveRoot mounts. */
  configure(config: ObserveConfig): void {
    getClient().configure(config);
  },
  /** Records a user-defined event (lowercase, dot-separated name). */
  logEvent(name: string, options?: LogEventOptions): void {
    getClient().logEvent(name, options);
  },
  /** Reports a handled error. Returns the event id. */
  reportError(error: unknown, context?: CaptureContext): string | undefined {
    return getClient().captureError(error, context);
  },
  /** Alias of reportError. */
  captureException(error: unknown, context?: CaptureContext): string | undefined {
    return getClient().captureError(error, context);
  },
  /** Global time to interactive, for code outside screens. */
  markInteractive(options?: MarkInteractiveOptions): void {
    getClient().markInteractive(options);
  },
  /** Sends everything queued now. */
  dispatchEvents(): Promise<void> {
    return getClient().flush();
  },
  /** Attaches a user id (no other PII) to subsequent events; null clears it. */
  setUser(user: { id: string } | null): void {
    getClient().setUser(user);
  },
  /** Current session id, if the SDK is dispatching. */
  getSessionId(): string | undefined {
    return getClient().sessionId;
  },
} as const;

/** Helpers for verifying the integration. Never call these in production code paths. */
export const ObserveTesting = {
  /** Crashes the app natively (SIGSEGV or an uncaught NSException / JVM exception). */
  triggerNativeCrash(kind: 'signal' | 'exception' = 'signal'): void {
    getClient().triggerNativeCrash(kind);
  },
} as const;
