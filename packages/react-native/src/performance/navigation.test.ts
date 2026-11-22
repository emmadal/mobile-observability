import { describe, expect, it } from 'vitest';
import {
  focusedRouteOf,
  type NavigationStateLike,
  NavigationTracker,
  resolveUrl,
  routePattern,
  type ScreenMetric,
} from './navigation';

const stack = (
  ...routes: { key: string; name: string; params?: object; state?: NavigationStateLike }[]
) => ({
  index: routes.length - 1,
  routes,
});

function setup(options: { resolveUrl?: boolean; filteredParams?: string[] } = {}) {
  const clock = { now: 10_000 };
  const frames: (() => void)[] = [];
  const metrics: ScreenMetric[] = [];
  const tracker = new NavigationTracker({
    now: () => clock.now,
    nextFrame: (callback) => frames.push(callback),
    launchStart: () => 9_000,
    resolveUrl: options.resolveUrl ?? true,
    filteredParams: options.filteredParams ?? [],
    onMetric: (metric) => metrics.push(metric),
    onRouteChange: () => undefined,
  });
  const runFrames = () => {
    for (const frame of frames.splice(0)) frame();
  };
  return { clock, tracker, metrics, runFrames };
}

describe('route helpers', () => {
  it('builds route patterns', () => {
    expect(routePattern(['(tabs)', 'sessions/[sessionId]'])).toBe('/(tabs)/sessions/[sessionId]');
    expect(routePattern(['index'])).toBe('/');
    expect(routePattern(['(tabs)', 'index'])).toBe('/(tabs)');
    expect(routePattern(['__root', 'Home'])).toBe('/Home');
  });

  it('resolves Expo Router URLs without groups', () => {
    expect(resolveUrl('/(tabs)/products/[id]', { id: '7' })).toBe('/products/7');
    expect(resolveUrl('/docs/[...slug]', { slug: ['a', 'b'] })).toBe('/docs/a/b');
    expect(resolveUrl('/(tabs)', {})).toBe('/');
  });

  it('removes filtered params and hides the url (AC-34)', () => {
    const state = stack({
      key: 'k1',
      name: 'profile/[userId]',
      params: { userId: 'u1', token: 'secret', tab: 'a' },
    });
    const route = focusedRouteOf(state, { resolveUrl: true, filteredParams: ['token'] });
    expect(route).toMatchObject({
      routeName: '/profile/[userId]',
      routeParams: { userId: 'u1', tab: 'a' },
      urlHidden: true,
    });
    expect(route?.url).toBeUndefined();
  });
});

describe('NavigationTracker (AC-34)', () => {
  it('measures the first screen from launch as cold_ttr with isAppLaunch', () => {
    const { tracker, metrics, runFrames, clock } = setup();
    tracker.onState(stack({ key: 'home', name: 'index' }));
    clock.now = 10_500;
    runFrames();
    expect(metrics).toEqual([
      expect.objectContaining({ name: 'navigation.cold_ttr', valueMs: 1_500, isAppLaunch: true }),
    ]);
  });

  it('records cold_ttr for a new screen and warm_ttr when returning to a mounted one', () => {
    const { tracker, metrics, runFrames, clock } = setup();
    tracker.onState(stack({ key: 'home', name: 'index' }));
    runFrames();

    clock.now = 20_000;
    tracker.onState(
      stack(
        { key: 'home', name: 'index' },
        { key: 'p1', name: 'products/[id]', params: { id: '1' } },
      ),
    );
    clock.now = 20_120;
    runFrames();
    expect(metrics.at(-1)).toMatchObject({
      name: 'navigation.cold_ttr',
      valueMs: 120,
      isAppLaunch: false,
      route: { routeName: '/products/[id]', url: '/products/1', routeParams: { id: '1' } },
    });

    clock.now = 30_000;
    tracker.onState(stack({ key: 'home', name: 'index' }));
    clock.now = 30_016;
    runFrames();
    expect(metrics.at(-1)).toMatchObject({ name: 'navigation.warm_ttr', valueMs: 16 });
  });

  it('treats a popped then re-pushed screen as cold', () => {
    const { tracker, metrics, runFrames } = setup();
    tracker.onState(stack({ key: 'home', name: 'index' }));
    tracker.onState(stack({ key: 'home', name: 'index' }, { key: 'p1', name: 'product' }));
    tracker.onState(stack({ key: 'home', name: 'index' }));
    tracker.onState(stack({ key: 'home', name: 'index' }, { key: 'p2', name: 'product' }));
    runFrames();
    expect(metrics.map((m) => m.name)).toEqual([
      'navigation.cold_ttr',
      'navigation.cold_ttr',
      'navigation.warm_ttr',
      'navigation.cold_ttr',
    ]);
  });

  it('records screen TTI once per focus, and defers it until the screen is focused', () => {
    const { tracker, metrics, runFrames, clock } = setup();
    tracker.onState(stack({ key: 'home', name: 'index' }));
    runFrames();
    clock.now = 10_800;
    tracker.markInteractive('home', { cacheHit: true });
    tracker.markInteractive('home');
    const ttis = metrics.filter((m) => m.name === 'navigation.tti');
    expect(ttis).toHaveLength(1);
    expect(ttis[0]).toMatchObject({ valueMs: 1_800, route: { routeParams: { cacheHit: true } } });

    tracker.markInteractive('later');
    expect(metrics.filter((m) => m.name === 'navigation.tti')).toHaveLength(1);
    clock.now = 12_000;
    tracker.onState(stack({ key: 'home', name: 'index' }, { key: 'later', name: 'later' }));
    runFrames();
    expect(metrics.filter((m) => m.name === 'navigation.tti')).toHaveLength(2);
  });
});
