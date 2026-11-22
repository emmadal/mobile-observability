import { toJsonObject } from '../core/json';
import type { JsonObject } from '../types';

/** Minimal shape of React Navigation state, shared by Expo Router. */
export interface NavigationStateLike {
  index?: number;
  routes: NavigationRouteLike[];
}

export interface NavigationRouteLike {
  key: string;
  name: string;
  params?: object;
  state?: NavigationStateLike;
}

/** Minimal shape of a NavigationContainer ref. */
export interface NavigationRefLike {
  isReady(): boolean;
  getRootState(): NavigationStateLike | undefined;
  addListener(event: 'state' | '__unsafe_action__', listener: () => void): () => void;
}

export interface FocusedRoute {
  key: string;
  routeName: string;
  routeParams: JsonObject;
  url?: string;
  urlHidden?: boolean;
}

export interface ScreenMetric {
  name: 'navigation.cold_ttr' | 'navigation.warm_ttr' | 'navigation.tti';
  valueMs: number;
  route: FocusedRoute;
  isAppLaunch?: boolean;
}

export interface NavigationTrackerOptions {
  now: () => number;
  nextFrame: (callback: () => void) => void;
  /** Epoch ms of process start; the first screen is measured from it. */
  launchStart: () => number;
  /** Expo Router resolves a URL from the pattern; React Navigation does not. */
  resolveUrl: boolean;
  filteredParams: string[];
  onMetric: (metric: ScreenMetric) => void;
  onRouteChange: (route: FocusedRoute) => void;
}

/** Builds `/a/b/[id]` from the focused route chain; drops `index` leaves and internal `__` routes. */
export function routePattern(names: string[]): string {
  const segments = names.filter((name) => !name.startsWith('__'));
  let pattern = `/${segments.join('/')}`.replace(/\/{2,}/g, '/');
  if (pattern.endsWith('/index')) pattern = pattern.slice(0, -'/index'.length) || '/';
  return pattern;
}

/** Expo Router: `/(tabs)/product/[id]` + `{ id: '7' }` gives `/product/7`. */
export function resolveUrl(pattern: string, params: Record<string, unknown>): string {
  const resolved = pattern
    .split('/')
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')))
    .map((segment) => {
      const catchAll = /^\[\.\.\.(.+)\]$/.exec(segment);
      if (catchAll) {
        const value = params[catchAll[1] ?? ''];
        return Array.isArray(value) ? value.join('/') : String(value ?? '');
      }
      const dynamic = /^\[(.+)\]$/.exec(segment);
      if (dynamic) return encodeURIComponent(String(params[dynamic[1] ?? ''] ?? ''));
      return segment;
    })
    .join('/');
  return resolved.startsWith('/') ? resolved || '/' : `/${resolved}`;
}

export function focusedRouteOf(
  state: NavigationStateLike,
  options: { resolveUrl: boolean; filteredParams: string[] },
): FocusedRoute | null {
  const names: string[] = [];
  let current: NavigationStateLike | undefined = state;
  let route: NavigationRouteLike | undefined;
  while (current && current.routes.length > 0) {
    route = current.routes[current.index ?? current.routes.length - 1];
    if (!route) break;
    names.push(route.name);
    current = route.state;
  }
  if (!route) return null;

  const routeName = routePattern(names);
  const rawParams = (route.params ?? {}) as Record<string, unknown>;
  const filtered = options.filteredParams.filter((key) => key in rawParams);
  const kept = Object.fromEntries(
    Object.entries(rawParams).filter(([key]) => !options.filteredParams.includes(key)),
  );
  const focused: FocusedRoute = { key: route.key, routeName, routeParams: toJsonObject(kept) };
  if (options.resolveUrl) {
    if (filtered.length > 0) focused.urlHidden = true;
    else focused.url = resolveUrl(routeName, rawParams);
  }
  return focused;
}

function collectKeys(state: NavigationStateLike | undefined, into: Set<string>): Set<string> {
  for (const route of state?.routes ?? []) {
    into.add(route.key);
    collectKeys(route.state, into);
  }
  return into;
}

/**
 * Turns navigation state changes into per-screen metrics (AC-34): the first
 * render of a screen instance is `cold_ttr`, refocusing a mounted one is
 * `warm_ttr`, and `markInteractive` inside a screen gives `navigation.tti`.
 */
export class NavigationTracker {
  private focused: FocusedRoute | null = null;
  private pendingActionAt: number | null = null;
  private readonly renderedKeys = new Set<string>();
  private readonly focusStartedAt = new Map<string, number>();
  private readonly interactiveRecorded = new Set<string>();
  private readonly interactivePending = new Map<string, JsonObject | undefined>();
  private detach: (() => void) | null = null;

  constructor(private readonly options: NavigationTrackerOptions) {}

  get currentRoute(): FocusedRoute | null {
    return this.focused;
  }

  attach(ref: NavigationRefLike): () => void {
    this.detach?.();
    const unsubscribeAction = ref.addListener('__unsafe_action__', () => {
      this.pendingActionAt ??= this.options.now();
    });
    const unsubscribeState = ref.addListener('state', () => this.onState(ref.getRootState()));
    if (ref.isReady()) this.onState(ref.getRootState());
    this.detach = () => {
      unsubscribeAction();
      unsubscribeState();
    };
    return () => {
      this.detach?.();
      this.detach = null;
    };
  }

  onState(state: NavigationStateLike | undefined): void {
    if (!state) return;
    const next = focusedRouteOf(state, {
      resolveUrl: this.options.resolveUrl,
      filteredParams: this.options.filteredParams,
    });
    const liveKeys = collectKeys(state, new Set<string>());
    for (const key of this.renderedKeys) if (!liveKeys.has(key)) this.renderedKeys.delete(key);
    if (!next || next.key === this.focused?.key) {
      if (next) this.focused = next;
      this.pendingActionAt = null;
      return;
    }

    const isAppLaunch = this.focused === null;
    const startedAt = isAppLaunch
      ? this.options.launchStart()
      : (this.pendingActionAt ?? this.options.now());
    this.pendingActionAt = null;
    const cold = !this.renderedKeys.has(next.key);
    this.renderedKeys.add(next.key);
    this.focused = next;
    this.focusStartedAt.set(next.key, startedAt);
    this.options.onRouteChange(next);

    this.options.nextFrame(() => {
      const valueMs = Math.max(0, this.options.now() - startedAt);
      this.options.onMetric({
        name: cold ? 'navigation.cold_ttr' : 'navigation.warm_ttr',
        valueMs,
        route: next,
        ...(cold ? { isAppLaunch } : {}),
      });
      if (this.interactivePending.has(next.key)) {
        const params = this.interactivePending.get(next.key);
        this.interactivePending.delete(next.key);
        this.emitInteractive(next, valueMs, params);
      }
    });
  }

  /** Called from `useObserve().markInteractive()` inside a screen. Records once per screen focus. */
  markInteractive(routeKey: string | undefined, params?: JsonObject): void {
    const route = this.focused;
    if (!routeKey || !route) return;
    if (route.key !== routeKey) {
      this.interactivePending.set(routeKey, params);
      return;
    }
    const startedAt = this.focusStartedAt.get(routeKey);
    if (startedAt === undefined) return;
    this.emitInteractive(route, Math.max(0, this.options.now() - startedAt), params);
  }

  private emitInteractive(route: FocusedRoute, valueMs: number, params?: JsonObject): void {
    const recordKey = `${route.key}@${this.focusStartedAt.get(route.key) ?? 0}`;
    if (this.interactiveRecorded.has(recordKey)) return;
    this.interactiveRecorded.add(recordKey);
    this.options.onMetric({
      name: 'navigation.tti',
      valueMs,
      route: params ? { ...route, routeParams: { ...route.routeParams, ...params } } : route,
    });
  }
}
