import {
  type BreadcrumbInput,
  type ErrorKind,
  INGEST_PATHS,
  type ItemInput,
  type MetricName,
} from '@mobile-observability/protocol';
import { normalizeError } from '../errors/normalize';
import type { DeviceStateSnapshot } from '../native/types';
import { type CompletedRequest, NetworkTracker } from '../network/network-tracker';
import {
  type FocusedRoute,
  type NavigationRefLike,
  NavigationTracker,
  type ScreenMetric,
} from '../performance/navigation';
import { StartupCollector } from '../performance/startup';
import { SessionManager, type SessionUpdate } from '../sessions/session-manager';
import { type EnvelopeContext, PersistentQueue } from '../transport/queue';
import { Transport } from '../transport/transport';
import type {
  CaptureContext,
  ErrorEvent,
  JsonObject,
  LogEventOptions,
  MarkInteractiveOptions,
  NavigationIntegrationOptions,
  ObserveConfig,
} from '../types';
import { BreadcrumbBuffer } from './breadcrumbs';
import { DEFAULT_HANG_THRESHOLD_MS, HangWatchdog } from './hang-watchdog';
import { isSampledIn, uuid } from './ids';
import { toJsonObject } from './json';
import type { AppStateStatus, PlatformAdapter } from './platform';
import { type CrashContext, convertPendingReport, type JsFatalReport } from './reports';

export const SDK_INFO = { name: '@mobile-observability/react-native', version: '0.1.1' } as const;

const DEFAULTS = {
  sampleRate: 1,
  dispatchInDebug: false,
  enabled: true,
  errorHandlingEnabled: true,
  hangTrackingEnabled: true,
  hangThresholdMs: DEFAULT_HANG_THRESHOLD_MS,
  networkTrackingEnabled: true,
  sessionTimeoutMs: 30_000,
  flushIntervalMs: 10_000,
  flushAtItems: 50,
  crashContextBreadcrumbs: 30,
} as const;

export type NavigationIntegration = 'expo-router' | 'react-navigation';

/**
 * Orchestrates collection: owns the queue, transport, session, startup and
 * navigation collectors, and turns every signal into a protocol item.
 */
export class ObservabilityClient {
  private config: ObserveConfig = {};
  private started = false;
  private startScheduled = false;
  private rootMounted = false;
  private dispatching = false;
  private context: EnvelopeContext | null = null;
  private queue: PersistentQueue | null = null;
  private transport: Transport | null = null;
  private sessions: SessionManager | null = null;
  private network: NetworkTracker | null = null;
  private navigation: NavigationTracker | null = null;
  private hangWatchdog: HangWatchdog | null = null;
  private appStateStatus: AppStateStatus = 'active';
  private user: { id: string } | undefined;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private crashContextTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly cleanups: (() => void)[] = [];
  private readonly breadcrumbs = new BreadcrumbBuffer();
  private readonly startup: StartupCollector;
  private readonly sdkLoadedAt: number;

  constructor(private readonly platform: PlatformAdapter) {
    this.sdkLoadedAt = platform.now();
    this.startup = new StartupCollector({
      now: () => platform.now(),
      launchInfo: () => platform.native.getLaunchInfo(),
      startupTiming: () => platform.startupTiming(),
      sdkLoadedAt: this.sdkLoadedAt,
      onMetric: (metric) =>
        this.recordMetric(metric.name, metric.valueMs, {
          ...(metric.params ? { params: metric.params } : {}),
        }),
    });
  }

  // MARK: Configuration and lifecycle

  /** Merges configuration. Must run at module scope: after the root mounts it throws (AC-33). */
  configure(config: ObserveConfig): void {
    if (this.rootMounted) {
      throw new Error(
        '[mobile-observability] Observe.configure() must be called at module scope, before ObserveRoot mounts.',
      );
    }
    this.config = {
      ...this.config,
      ...config,
      integrations: { ...this.config.integrations, ...config.integrations },
    };
    if (!this.startScheduled) {
      this.startScheduled = true;
      // Let several synchronous configure() calls merge before starting.
      void Promise.resolve().then(() => this.start());
    }
  }

  get isDispatching(): boolean {
    return this.dispatching;
  }

  get sessionId(): string | undefined {
    return this.sessions?.sessionId;
  }

  integrationOptions(kind: NavigationIntegration): NavigationIntegrationOptions | null {
    const value = this.config.integrations?.[kind];
    if (!value) return null;
    return value === true ? {} : value;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const config = { ...DEFAULTS, ...this.platform.manifestConfig(), ...this.config };
    if (!config.enabled) return;

    const { native } = this.platform;
    if (!native.isAvailable) {
      this.platform.warn(
        '[mobile-observability] Native module not found (Expo Go?). JS errors, requests, screens and sessions are reported; native crashes and launch timings are not.',
      );
    }
    this.context = this.buildContext(config.environment);
    const isDebug = this.platform.isDevBundle || (native.getAppInfo()?.isDebugBuild ?? false);
    if (isDebug && !config.dispatchInDebug) {
      this.platform.warn(
        '[mobile-observability] Debug build: not dispatching. Set dispatchInDebug: true to test.',
      );
      return;
    }
    if (!config.apiKey || !config.endpoint) {
      this.platform.warn('[mobile-observability] Missing apiKey or endpoint: not dispatching.');
      return;
    }
    if (!isSampledIn(this.context.installationId, config.sampleRate)) return;

    this.dispatching = true;
    this.queue = new PersistentQueue({
      get: (key) => native.storageGet(key),
      set: (key, value) => native.storageSet(key, value),
    });
    this.transport = new Transport({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      sdk: SDK_INFO,
      queue: this.queue,
      post: this.platform.post,
      now: () => this.platform.now(),
    });

    this.sendPendingReports();
    this.sessions = new SessionManager({
      timeoutMs: config.sessionTimeoutMs,
      now: () => this.platform.now(),
      onUpdate: (update) => this.onSessionUpdate(update),
    });
    this.sessions.start();

    if (config.errorHandlingEnabled) {
      this.cleanups.push(
        this.platform.installErrorHandler((error, isFatal) => this.onGlobalError(error, isFatal)),
      );
      this.cleanups.push(
        this.platform.installRejectionTracker((reason) =>
          this.captureError(reason, { handled: false, kind: 'promise_rejection' }),
        ),
      );
    }
    if (config.networkTrackingEnabled)
      this.installNetworkTracking(config.endpoint, config.ignoreUrls ?? []);

    this.cleanups.push(this.platform.appState.subscribe((state) => this.onAppStateChange(state)));
    if (config.hangTrackingEnabled) this.installHangWatchdog(config.hangThresholdMs);
    const warm = native.addWarmLaunchListener((durationMs) =>
      this.startup.onWarmLaunch(durationMs),
    );
    this.cleanups.push(() => warm.remove());

    this.flushTimer = setInterval(() => void this.flush(), config.flushIntervalMs);
    this.syncCrashContext();
    void this.flush();
  }

  /** Test/teardown helper: removes handlers and timers. */
  close(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.network?.uninstall();
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.crashContextTimer) clearTimeout(this.crashContextTimer);
    this.flushTimer = null;
    this.crashContextTimer = null;
  }

  private buildContext(environment: string | undefined): EnvelopeContext {
    const { native } = this.platform;
    const app = native.getAppInfo() ?? this.platform.fallbackAppInfo();
    const updates = this.platform.updatesInfo();
    let installationId = native.getInstallationId();
    if (!installationId) {
      installationId = native.storageGet('__installationId') ?? uuid();
      void native.storageSet('__installationId', installationId);
    }
    return {
      installationId,
      app: {
        version: app.version,
        build: app.build,
        environment: environment ?? process.env.NODE_ENV ?? 'production',
        ...(app.bundleId ? { bundleId: app.bundleId } : {}),
        ...(updates.updateId ? { updateId: updates.updateId } : {}),
        ...(updates.runtimeVersion ? { runtimeVersion: updates.runtimeVersion } : {}),
        ...(updates.channel ? { channel: updates.channel } : {}),
        ...(updates.isEmbeddedLaunch !== undefined
          ? { isEmbeddedLaunch: updates.isEmbeddedLaunch }
          : {}),
      },
      device: {
        platform: app.platform,
        osVersion: app.osVersion,
        ...(app.model ? { model: app.model } : {}),
        ...(app.manufacturer ? { manufacturer: app.manufacturer } : {}),
        ...(app.isEmulator !== undefined ? { isEmulator: app.isEmulator } : {}),
        ...(app.locale ? { locale: app.locale } : {}),
      },
      ...(this.user ? { user: this.user } : {}),
    };
  }

  // MARK: Root and navigation

  onRootMounted(): void {
    this.rootMounted = true;
    this.start();
  }

  /** Called by ObserveRoot when its view first lays out (TTR). */
  onRootLayout(): void {
    this.platform.nextFrame(() => this.startup.onFirstRender());
    setTimeout(() => this.startup.recordColdLaunch(), 1_000);
  }

  attachNavigation(ref: NavigationRefLike, kind: NavigationIntegration): () => void {
    const options = this.integrationOptions(kind) ?? {};
    this.navigation ??= new NavigationTracker({
      now: () => this.platform.now(),
      nextFrame: (callback) => this.platform.nextFrame(callback),
      launchStart: () => this.startup.launchStart(),
      resolveUrl: kind === 'expo-router',
      filteredParams: options.filteredParams ?? [],
      onMetric: (metric) => this.onScreenMetric(metric),
      onRouteChange: (route) => this.onRouteChange(route),
    });
    return this.navigation.attach(ref);
  }

  private onRouteChange(route: FocusedRoute): void {
    this.addBreadcrumb({
      category: 'navigation',
      message: route.routeName,
      data: { url: route.url ?? null },
    });
    this.syncCrashContext(true);
  }

  private onScreenMetric(metric: ScreenMetric): void {
    const params: JsonObject = {
      routeParams: metric.route.routeParams,
      ...(metric.route.url !== undefined ? { url: metric.route.url } : {}),
      ...(metric.route.urlHidden ? { urlHidden: true } : {}),
      ...(metric.isAppLaunch !== undefined ? { isAppLaunch: metric.isAppLaunch } : {}),
    };
    this.recordMetric(metric.name, metric.valueMs, { routeName: metric.route.routeName, params });
  }

  // MARK: Time to interactive

  /** App-level TTI (first call only) and, inside a screen, that screen's TTI. */
  markInteractive(options: MarkInteractiveOptions = {}, routeKey?: string): void {
    if (!this.dispatching) return;
    const custom = options.params ? toJsonObject(options.params) : undefined;
    if (routeKey) this.navigation?.markInteractive(routeKey, custom);
    if (this.startup.isInteractiveRecorded) return;
    const routeName = options.routeName ?? this.navigation?.currentRoute?.routeName;
    const params: JsonObject = { ...this.automaticInteractiveParams(), ...custom };
    if (routeName) params.routeName = routeName;
    this.startup.markInteractive(params);
    this.platform.native.stopFrameTracking();
  }

  private automaticInteractiveParams(): JsonObject {
    const { native } = this.platform;
    const params: JsonObject = {};
    const frames = native.getFrameStats();
    if (frames) {
      params['frameRate.slowFrames'] = frames.slowFrames;
      params['frameRate.frozenFrames'] = frames.frozenFrames;
      params['frameRate.totalDelay'] = Math.round(frames.totalDelayMs);
    }
    addDeviceParams(params, native.getDeviceState());

    const launch = native.getLaunchInfo();
    const windowStart =
      launch?.coldLaunchMs !== undefined
        ? launch.processStartTime + launch.coldLaunchMs
        : this.startup.launchStart();
    const summary = this.network?.summarize(windowStart, this.platform.now());
    if (summary) {
      params['network.requests.count'] = summary.count;
      params['network.requests.failed'] = summary.failed;
      params['network.requests.bytesReceived'] = summary.bytesReceived;
      params['network.requests.bytesSent'] = summary.bytesSent;
      params['network.requests.totalDuration'] = Math.round(summary.totalDuration);
      if (summary.slowest) {
        params['network.requests.slowest.duration'] = Math.round(summary.slowest.duration);
        params['network.requests.slowest.host'] = summary.slowest.host;
        params['network.requests.slowest.statusCode'] = summary.slowest.statusCode;
        if (summary.slowest.timeToFirstByte !== undefined) {
          params['network.requests.slowest.timeToFirstByte'] = Math.round(
            summary.slowest.timeToFirstByte,
          );
        }
        if (summary.slowest.bytesReceived !== undefined) {
          params['network.requests.slowest.bytesReceived'] = summary.slowest.bytesReceived;
        }
      }
    }
    return params;
  }

  // MARK: Errors

  captureError(
    thrown: unknown,
    options: CaptureContext & { kind?: ErrorKind; fatal?: boolean } = {},
  ): string | undefined {
    const item = this.buildErrorItem(thrown, {
      fatal: options.fatal ?? false,
      handled: options.handled ?? true,
      kind: options.kind ?? 'exception',
      ...(options.tags ? { tags: options.tags } : {}),
    });
    if (!item) return undefined;
    this.sessions?.recordError(false);
    this.enqueue(item);
    return item.eventId;
  }

  private onGlobalError(thrown: unknown, isFatal: boolean): void {
    if (!isFatal) {
      this.captureError(thrown, { handled: false });
      return;
    }
    const item = this.buildErrorItem(thrown, { fatal: true, handled: false, kind: 'exception' });
    if (!item || !this.context) return;
    this.sessions?.recordError(true);
    const { native } = this.platform;
    if (native.isAvailable) {
      // The app is about to terminate: persist synchronously, send on next launch.
      const report: JsFatalReport = {
        id: item.eventId,
        kind: 'js_fatal',
        item,
        context: this.context,
      };
      native.persistJsFatal(JSON.stringify(report));
    } else {
      this.enqueue(item, { persistNow: true });
    }
  }

  private buildErrorItem(
    thrown: unknown,
    options: { fatal: boolean; handled: boolean; kind: ErrorKind; tags?: Record<string, string> },
  ): ErrorEvent | null {
    if (!this.dispatching) return null;
    const normalized = normalizeError(thrown);
    const route = this.navigation?.currentRoute;
    const event: ErrorEvent = {
      type: 'error',
      eventId: uuid(),
      timestamp: this.platform.now(),
      origin: 'js',
      kind: options.kind,
      fatal: options.fatal,
      handled: options.handled,
      exception: { type: normalized.type, message: normalized.message, frames: normalized.frames },
      breadcrumbs: this.breadcrumbs.snapshot(),
      ...(this.sessions?.sessionId ? { sessionId: this.sessions.sessionId } : {}),
      ...(route ? { routeName: route.routeName } : {}),
      ...(options.tags ? { tags: options.tags } : {}),
      ...(normalized.stack ? { rawStack: normalized.stack } : {}),
    };
    const result = this.config.beforeSend
      ? safeCall(() => this.config.beforeSend?.(event), event)
      : event;
    if (!result) return null;
    this.addBreadcrumb({
      category: 'error',
      level: 'error',
      message: `${normalized.type}: ${normalized.message}`,
    });
    return result;
  }

  private sendPendingReports(): void {
    const { native } = this.platform;
    const reports = native.getPendingReports();
    if (reports.length === 0 || !this.queue || !this.context) return;
    const handled: string[] = [];
    for (const raw of reports) {
      const converted = convertPendingReport(raw, this.context);
      if (converted) this.queue.enqueue(converted.context, converted.item);
      const id = safeParseId(raw);
      if (id) handled.push(id);
    }
    // Delete from native storage only once the queue copy is on disk.
    void this.queue.persist().then(() => native.deletePendingReports(handled));
  }

  // MARK: Events, metrics, requests

  logEvent(name: string, options: LogEventOptions = {}): void {
    if (!this.dispatching || !name) return;
    const attributes = options.attributes ? toJsonObject(options.attributes) : undefined;
    this.enqueue({
      type: 'event',
      eventId: uuid(),
      timestamp: this.platform.now(),
      name,
      severity: options.severity ?? 'info',
      ...(this.sessions?.sessionId ? { sessionId: this.sessions.sessionId } : {}),
      ...(options.body ? { body: options.body } : {}),
      ...(options.displayName ? { displayName: options.displayName } : {}),
      ...(attributes ? { attributes } : {}),
    });
    if (!name.startsWith('$')) {
      this.addBreadcrumb({ category: 'event', message: options.displayName ?? name });
    }
  }

  recordMetric(
    name: MetricName,
    valueMs: number,
    options: { routeName?: string; params?: JsonObject } = {},
  ): void {
    if (!this.dispatching) return;
    this.enqueue({
      type: 'metric',
      eventId: uuid(),
      timestamp: this.platform.now(),
      name,
      valueMs: Math.round(valueMs * 100) / 100,
      ...(this.sessions?.sessionId ? { sessionId: this.sessions.sessionId } : {}),
      ...(options.routeName ? { routeName: options.routeName } : {}),
      ...(options.params ? { params: options.params } : {}),
    });
  }

  private installNetworkTracking(endpoint: string, ignoreUrls: (string | RegExp)[]): void {
    const ingestBase = endpoint.replace(/\/+$/, '');
    const ownPaths = Object.values(INGEST_PATHS).map((path) => `${ingestBase}${path}`);
    this.network = new NetworkTracker({
      now: () => this.platform.now(),
      shouldIgnore: (url) =>
        ownPaths.some((own) => url.startsWith(own)) ||
        ignoreUrls.some((pattern) =>
          typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url),
        ),
      onRequest: (request) => this.onRequest(request),
    });
    this.network.install(this.platform.XMLHttpRequest);
    if (this.platform.fetchTarget) this.network.installFetch(this.platform.fetchTarget);
  }

  private onRequest(request: CompletedRequest): void {
    const route = this.navigation?.currentRoute;
    this.enqueue({
      type: 'request',
      eventId: uuid(),
      timestamp: request.startedAt,
      method: request.method,
      host: request.host,
      path: request.path,
      statusCode: request.statusCode,
      durationMs: Math.round(request.durationMs),
      ...(this.sessions?.sessionId ? { sessionId: this.sessions.sessionId } : {}),
      ...(request.bytesReceived !== undefined ? { bytesReceived: request.bytesReceived } : {}),
      ...(request.bytesSent !== undefined ? { bytesSent: request.bytesSent } : {}),
      ...(request.timeToFirstByteMs !== undefined
        ? { timeToFirstByteMs: Math.round(request.timeToFirstByteMs) }
        : {}),
      ...(request.traceId ? { traceId: request.traceId } : {}),
      ...(request.error ? { error: request.error } : {}),
      ...(route ? { routeName: route.routeName } : {}),
    });
    this.addBreadcrumb({
      category: 'request',
      level: request.statusCode === 0 || request.statusCode >= 400 ? 'error' : 'info',
      message: `${request.method} ${request.host}${request.path} ${request.statusCode}`,
      data: { durationMs: Math.round(request.durationMs) },
    });
  }

  // MARK: Sessions and app state

  private onSessionUpdate(update: SessionUpdate): void {
    this.enqueue({
      type: 'session',
      sessionId: update.sessionId,
      startedAt: update.startedAt,
      status: update.status,
      errorCount: update.errorCount,
      init: update.init,
      ...(update.endedAt !== undefined ? { endedAt: update.endedAt } : {}),
    });
    this.syncCrashContext(true);
  }

  private onAppStateChange(state: AppStateStatus): void {
    this.appStateStatus = state;
    if (state === 'background') {
      this.logEvent('$app.background', { severity: 'debug' });
      this.addBreadcrumb({ category: 'app_state', message: 'background' });
      this.sessions?.onBackground();
      void this.flush();
    } else if (state === 'active') {
      this.sessions?.onForeground();
      this.addBreadcrumb({ category: 'app_state', message: 'foreground' });
      this.logEvent('$app.foreground', { severity: 'debug' });
    }
  }

  /** Test helper used by the example app to verify native crash capture end to end. */
  triggerNativeCrash(kind: 'signal' | 'exception'): void {
    this.platform.native.triggerTestCrash(kind);
  }

  private installHangWatchdog(thresholdMs: number | undefined): void {
    const watchdog = new HangWatchdog({
      hangThresholdMs: thresholdMs,
      isForeground: () => this.appStateStatus !== 'background',
      onHang: (durationMs) => this.reportHang(durationMs),
    });
    watchdog.start(setInterval, clearInterval);
    this.hangWatchdog = watchdog;
    this.cleanups.push(() => {
      this.hangWatchdog?.stop(clearInterval);
      this.hangWatchdog = null;
    });
  }

  /**
   * A blocked JS thread is a user-visible freeze: reported as a handled,
   * non-fatal error of kind `hang` so it groups into its own issue.
   */
  private reportHang(durationMs: number): void {
    if (!this.dispatching) return;
    const seconds = Math.max(1, Math.round(durationMs / 1000));
    const route = this.navigation?.currentRoute;
    const event: ErrorEvent = {
      type: 'error',
      eventId: uuid(),
      timestamp: this.platform.now(),
      origin: 'js',
      kind: 'hang',
      fatal: false,
      handled: true,
      exception: {
        type: 'AppHang',
        message: `JS thread blocked for ~${seconds} s`,
        frames: [],
      },
      breadcrumbs: this.breadcrumbs.snapshot(),
      ...(this.sessions?.sessionId ? { sessionId: this.sessions.sessionId } : {}),
      ...(route ? { routeName: route.routeName } : {}),
    };
    this.enqueue(event);
    this.addBreadcrumb({ category: 'app_state', message: `hang ~${seconds} s` });
  }

  // MARK: User

  setUser(user: { id: string } | null): void {
    this.user = user ?? undefined;
    if (this.context) {
      this.context = { ...this.context };
      if (this.user) this.context.user = this.user;
      else delete this.context.user;
      this.syncCrashContext(true);
    }
  }

  // MARK: Queue and dispatch

  private enqueue(item: ItemInput, options: { persistNow?: boolean } = {}): void {
    if (!this.queue || !this.context) return;
    this.queue.enqueue(this.context, item, options);
    if (this.queue.length >= DEFAULTS.flushAtItems) void this.flush();
  }

  async flush(): Promise<void> {
    await this.transport?.flush();
  }

  addBreadcrumb(breadcrumb: Omit<BreadcrumbInput, 'timestamp'>): void {
    this.breadcrumbs.add({ ...breadcrumb, timestamp: this.platform.now() });
    this.syncCrashContext();
  }

  /** Mirrors context into the native crash handler; debounced except for important changes. */
  private syncCrashContext(immediate = false): void {
    if (!this.dispatching || !this.context) return;
    const write = () => {
      this.crashContextTimer = null;
      if (!this.context) return;
      const context: CrashContext = {
        breadcrumbs: this.breadcrumbs.snapshot(DEFAULTS.crashContextBreadcrumbs),
        envelope: this.context,
        ...(this.sessions?.sessionId ? { sessionId: this.sessions.sessionId } : {}),
        ...(this.navigation?.currentRoute
          ? { routeName: this.navigation.currentRoute.routeName }
          : {}),
      };
      this.platform.native.setCrashContext(JSON.stringify(context));
    };
    if (immediate) {
      if (this.crashContextTimer) clearTimeout(this.crashContextTimer);
      write();
    } else if (!this.crashContextTimer) {
      this.crashContextTimer = setTimeout(write, 500);
    }
  }
}

function addDeviceParams(params: JsonObject, state: DeviceStateSnapshot): void {
  const mapping: [keyof DeviceStateSnapshot, string][] = [
    ['lowPowerMode', 'device.lowPowerMode'],
    ['thermalState', 'device.thermalState'],
    ['batteryLevel', 'device.batteryLevel'],
    ['batteryCharging', 'device.batteryCharging'],
    ['networkConnected', 'network.connected'],
    ['networkType', 'network.type'],
    ['networkExpensive', 'network.isExpensive'],
    ['networkConstrained', 'network.isConstrained'],
    ['dataSaverEnabled', 'network.dataSaverEnabled'],
  ];
  for (const [source, target] of mapping) {
    const value = state[source];
    if (value !== undefined) params[target] = value;
  }
}

function safeCall<T>(call: () => T, fallback: T): T {
  try {
    return call();
  } catch {
    return fallback;
  }
}

function safeParseId(raw: string): string | null {
  try {
    const id = (JSON.parse(raw) as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}
