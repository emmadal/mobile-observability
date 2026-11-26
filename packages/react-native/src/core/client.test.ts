import type { ItemInput } from '@mobile-observability/protocol';
import { describe, expect, it } from 'vitest';
import {
  createFakePlatform,
  createNativeLikeBridge,
  type FakePlatform,
  flushMicrotasks,
} from '../__tests__/helpers';
import type { NativeBridge } from '../native/types';
import type { ObserveConfig } from '../types';
import { ObservabilityClient } from './client';

const BASE: ObserveConfig = { apiKey: 'pk_test', endpoint: 'https://obs.example.com' };

async function started(config: ObserveConfig = {}, platform: FakePlatform = createFakePlatform()) {
  const client = new ObservabilityClient(platform);
  client.configure({ ...BASE, ...config });
  await flushMicrotasks();
  return { client, platform };
}

async function sentItems(
  client: ObservabilityClient,
  platform: FakePlatform,
): Promise<ItemInput[]> {
  await client.flush();
  return platform.sent.flatMap((envelope) => envelope.items);
}

describe('ObservabilityClient configuration', () => {
  it('merges synchronous configure calls before starting (AC-1)', async () => {
    const platform = createFakePlatform();
    const client = new ObservabilityClient(platform);
    client.configure({ integrations: { 'expo-router': true } });
    client.configure(BASE);
    await flushMicrotasks();
    expect(client.isDispatching).toBe(true);
    expect(client.integrationOptions('expo-router')).toEqual({});
    client.close();
  });

  it('throws when configure() runs after the root mounted (AC-33)', async () => {
    const { client } = await started();
    client.onRootMounted();
    expect(() => client.configure({ sampleRate: 0.5 })).toThrow(/module scope/);
    client.close();
  });

  it('does not dispatch from debug bundles unless dispatchInDebug (AC-11)', async () => {
    const debug = await started({}, createFakePlatform({ isDevBundle: true }));
    expect(debug.client.isDispatching).toBe(false);
    debug.client.captureError(new Error('x'));
    expect(await sentItems(debug.client, debug.platform)).toEqual([]);

    const allowed = await started(
      { dispatchInDebug: true },
      createFakePlatform({ isDevBundle: true }),
    );
    expect(allowed.client.isDispatching).toBe(true);
    allowed.client.close();
  });

  it('samples per installation: 0 sends nothing, 1 sends everything (AC-11)', async () => {
    const none = await started({ sampleRate: 0 });
    expect(none.client.isDispatching).toBe(false);
    const all = await started({ sampleRate: 1 });
    expect(all.client.isDispatching).toBe(true);
    all.client.close();
  });

  it('does not dispatch without apiKey or endpoint', async () => {
    const platform = createFakePlatform();
    const client = new ObservabilityClient(platform);
    client.configure({ endpoint: 'https://x' });
    await flushMicrotasks();
    expect(client.isDispatching).toBe(false);
    expect(platform.warnings.join()).toMatch(/apiKey/);
    expect(platform.warnings.join()).toMatch(/EXPO_PUBLIC_MOBS_KEY.*EXPO_PUBLIC_MOBS_ENDPOINT/);
  });

  it('reads apiKey and endpoint from app config extra', async () => {
    const platform = createFakePlatform({ manifestConfig: () => BASE });
    const client = new ObservabilityClient(platform);
    client.configure({});
    await flushMicrotasks();
    expect(client.isDispatching).toBe(true);
    client.close();
  });

  it('warns once and keeps JS features without the native module (AC-10)', async () => {
    const { client, platform } = await started();
    expect(platform.warnings.filter((w) => w.includes('Native module not found'))).toHaveLength(1);
    client.captureError(new Error('still reported'));
    const items = await sentItems(client, platform);
    expect(items.some((item) => item.type === 'error')).toBe(true);
    client.close();
  });
});

describe('ObservabilityClient errors (AC-2, AC-3)', () => {
  it('captures exceptions with context, breadcrumbs and session id', async () => {
    const { client, platform } = await started();
    client.logEvent('cart.opened');
    const eventId = client.captureError(new TypeError('boom'), { tags: { feature: 'cart' } });
    expect(eventId).toMatch(/^[0-9a-f-]{36}$/);
    const error = (await sentItems(client, platform)).find((item) => item.type === 'error');
    expect(error).toMatchObject({
      origin: 'js',
      kind: 'exception',
      fatal: false,
      handled: true,
      exception: { type: 'TypeError', message: 'boom' },
      tags: { feature: 'cart' },
      sessionId: client.sessionId,
    });
    expect((error as { breadcrumbs: unknown[] }).breadcrumbs).toEqual([
      expect.objectContaining({ category: 'event', message: 'cart.opened' }),
    ]);
    expect(platform.sent[0]?.app).toMatchObject({
      version: '1.0.0',
      updateId: 'update-1',
      channel: 'production',
    });
    client.close();
  });

  it('captures unhandled promise rejections as non-fatal', async () => {
    const { client, platform } = await started();
    platform.rejectionHandler?.(new Error('Payment API timeout'));
    const error = (await sentItems(client, platform)).find((item) => item.type === 'error');
    expect(error).toMatchObject({ kind: 'promise_rejection', fatal: false, handled: false });
    client.close();
  });

  it('lets beforeSend mutate or drop errors (AC-11)', async () => {
    const { client, platform } = await started({
      beforeSend: (event) =>
        event.exception.message.includes('drop') ? null : { ...event, tags: { scrubbed: 'yes' } },
    });
    expect(client.captureError(new Error('drop me'))).toBeUndefined();
    client.captureError(new Error('keep me'));
    const errors = (await sentItems(client, platform)).filter((item) => item.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ tags: { scrubbed: 'yes' } });
    client.close();
  });

  it('persists a fatal JS error synchronously through the native layer', async () => {
    const persisted: string[] = [];
    const native: NativeBridge = createNativeLikeBridge(null, {
      persistJsFatal: (json) => persisted.push(json),
    });
    const { client, platform } = await started({}, createFakePlatform({ native }));
    platform.errorHandler?.(new Error('fatal'), true);
    expect(persisted).toHaveLength(1);
    const report = JSON.parse(persisted[0] ?? '{}');
    expect(report).toMatchObject({
      kind: 'js_fatal',
      item: { fatal: true, handled: false, origin: 'js' },
    });
    expect(report.context.installationId).toBe('install-abc');
    client.close();
  });

  it('sends pending native crash reports from the previous launch first', async () => {
    const deleted: string[][] = [];
    const crash = {
      id: 'A1B2C3D4-0000-4000-8000-000000000001',
      kind: 'signal',
      type: 'SIGSEGV',
      message: 'SIGSEGV at 0x10',
      fatal: true,
      timestamp: 1_763_700_000_000,
      frames: [{ function: 'App + 0x1a', module: 'App', native: true, inApp: true }],
      context: {
        sessionId: 'old-session',
        routeName: '/checkout',
        breadcrumbs: [],
        envelope: {
          installationId: 'install-abc',
          app: { version: '1.9.0', build: '19' },
          device: { platform: 'ios', osVersion: '26.0' },
        },
      },
    };
    const native = createNativeLikeBridge(null, {
      getPendingReports: () => [JSON.stringify(crash)],
      deletePendingReports: (ids) => deleted.push(ids),
    });
    const { client, platform } = await started({}, createFakePlatform({ native }));
    await client.flush();
    const first = platform.sent[0];
    expect(first?.app.version).toBe('1.9.0');
    expect(first?.items[0]).toMatchObject({
      type: 'error',
      origin: 'native',
      kind: 'signal',
      fatal: true,
      sessionId: 'old-session',
      routeName: '/checkout',
      eventId: crash.id.toLowerCase(),
    });
    expect(deleted).toEqual([[crash.id]]);
    client.close();
  });
});

describe('ObservabilityClient sessions, events and TTI', () => {
  it('sends session updates and starts a new session after 30 s in background', async () => {
    const { client, platform } = await started();
    const first = client.sessionId;
    for (const listener of platform.appStateListeners) listener('background');
    platform.clock.now += 31_000;
    for (const listener of platform.appStateListeners) listener('active');
    expect(client.sessionId).not.toBe(first);
    const sessions = (await sentItems(client, platform)).filter((item) => item.type === 'session');
    expect(
      sessions.some(
        (s) => s.type === 'session' && s.sessionId === first && s.endedAt !== undefined,
      ),
    ).toBe(true);
    client.close();
  });

  it('logs user-defined events with attributes (AC-36)', async () => {
    const { client, platform } = await started();
    client.logEvent('report.exported', {
      attributes: { format: 'csv', rows: 3, when: new Date(), fn: () => 1 },
      severity: 'warn',
      displayName: 'Report exported',
    });
    const event = (await sentItems(client, platform)).find(
      (item) => item.type === 'event' && item.name === 'report.exported',
    );
    expect(event).toMatchObject({
      severity: 'warn',
      displayName: 'Report exported',
      attributes: { format: 'csv', rows: 3 },
    });
    client.close();
  });

  it('records TTI once with automatic params (AC-35)', async () => {
    const native = createNativeLikeBridge(
      { processStartTime: 1_763_799_998_000, coldLaunchMs: 400, prewarmed: false },
      {
        getFrameStats: () => ({ slowFrames: 3, frozenFrames: 1, totalDelayMs: 812.4 }),
        getDeviceState: () => ({
          lowPowerMode: false,
          thermalState: 'nominal',
          networkType: 'wifi',
          networkConnected: true,
        }),
      },
    );
    const { client, platform } = await started({}, createFakePlatform({ native }));
    client.markInteractive({ params: { cohort: 'beta' } });
    client.markInteractive();
    const ttis = (await sentItems(client, platform)).filter(
      (item) => item.type === 'metric' && item.name === 'app_startup.tti',
    );
    expect(ttis).toHaveLength(1);
    expect(ttis[0]).toMatchObject({
      valueMs: 2_000,
      params: {
        cohort: 'beta',
        'frameRate.slowFrames': 3,
        'frameRate.frozenFrames': 1,
        'frameRate.totalDelay': 812,
        'device.thermalState': 'nominal',
        'network.type': 'wifi',
        'network.connected': true,
      },
    });
    client.close();
  });

  it('records TTR, cold launch and screen metrics from the root and navigation', async () => {
    const native = createNativeLikeBridge({
      processStartTime: 1_763_799_999_000,
      coldLaunchMs: 300,
      prewarmed: false,
    });
    const { client, platform } = await started(
      { integrations: { 'expo-router': true } },
      createFakePlatform({ native }),
    );
    client.onRootMounted();
    client.onRootLayout();
    const listeners: Record<string, () => void> = {};
    let state = { index: 0, routes: [{ key: 'home', name: 'index' }] };
    client.attachNavigation(
      {
        isReady: () => true,
        getRootState: () => state,
        addListener: (event, listener) => {
          listeners[event] = listener;
          return () => undefined;
        },
      },
      'expo-router',
    );
    platform.clock.now += 500;
    platform.runFrames();
    listeners.__unsafe_action__?.();
    state = {
      index: 1,
      routes: [
        { key: 'home', name: 'index' },
        { key: 'p', name: 'products/[id]', params: { id: '3' } } as never,
      ],
    };
    listeners.state?.();
    platform.clock.now += 120;
    platform.runFrames();
    const metrics = (await sentItems(client, platform)).filter((item) => item.type === 'metric');
    expect(metrics.map((m) => (m.type === 'metric' ? m.name : ''))).toEqual(
      expect.arrayContaining([
        'app_startup.ttr',
        'app_startup.cold_launch_time',
        'navigation.cold_ttr',
      ]),
    );
    const productTtr = metrics.find((m) => m.type === 'metric' && m.routeName === '/products/[id]');
    expect(productTtr).toMatchObject({
      name: 'navigation.cold_ttr',
      valueMs: 120,
      params: { url: '/products/3', isAppLaunch: false },
    });
    client.close();
  });
});
