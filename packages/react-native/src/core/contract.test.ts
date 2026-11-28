import { parseEnvelope } from '@mobile-observability/protocol/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFakePlatform,
  createNativeLikeBridge,
  type FakePlatform,
  flushMicrotasks,
} from '../__tests__/helpers';
import type { DeviceStateSnapshot } from '../native/types';
import { ObservabilityClient } from './client';

/**
 * Contract between the SDK and the ingest server: every envelope the client
 * produces, across every collector, must pass the protocol's parseEnvelope.
 * A mismatch here means the dashboard rejects the whole envelope with a 400.
 */
describe('SDK to protocol contract', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function scenario(state: DeviceStateSnapshot) {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const native = createNativeLikeBridge(null, {
      getDeviceState: () => ({ ...state }),
      getFrameStats: () => ({ slowFrames: 3, frozenFrames: 1, totalDelayMs: 412.6 }),
    });
    const platform: FakePlatform = createFakePlatform({
      native,
      fetchTarget: {
        fetch: async () => new Response('{}', { status: 503, headers: { 'content-length': '2' } }),
      },
    });
    const client = new ObservabilityClient(platform);
    client.configure({
      apiKey: 'pk_test',
      endpoint: 'https://obs.example.com',
      resourceSampleIntervalMs: 1_000,
    });
    await flushMicrotasks();
    return { client, platform };
  }

  it('sends only envelopes the server accepts, with every 0.2.0 signal', async () => {
    const state: DeviceStateSnapshot = {
      networkConnected: true,
      networkType: 'wifi',
      batteryLevel: 0.42,
      batteryCharging: false,
      thermalState: 'fair',
      lowPowerMode: false,
    };
    const { client, platform } = await scenario(state);

    client.setUser({ id: 'user-1' });
    client.captureError(new TypeError('boom'));
    client.logEvent('checkout', { attributes: { cartSize: 3, password: 'hunter2' } });
    await platform.fetchTarget?.fetch?.('https://api.example.com/v1/orders?id=7', {
      method: 'post',
      body: '{}',
    });
    // biome-ignore lint/complexity/useLiteralKeys: reportHang is private; watchdog timing is covered by hang-watchdog.test.ts.
    client['reportHang'](3_200);
    vi.advanceTimersByTime(1_000);
    await client.flush();
    state.networkConnected = false;
    await client.flush();
    state.networkConnected = true;
    await client.flush();
    client.close();

    expect(platform.sent.length).toBeGreaterThan(0);
    for (const envelope of platform.sent) {
      const parsed = parseEnvelope(envelope);
      expect(parsed.ok ? [] : parsed.issues).toEqual([]);
    }

    const items = platform.sent.flatMap((envelope) => envelope.items);
    const events = items.flatMap((item) => (item.type === 'event' ? [item] : []));
    const names = events.map((event) => event.name);
    expect(names).toEqual(
      expect.arrayContaining(['checkout', '$device.health', '$net.offline', '$net.online']),
    );
    expect(names.filter((name) => name === '$net.online')).toHaveLength(1);
    expect(events.find((event) => event.name === 'checkout')?.attributes).toEqual({
      cartSize: 3,
      password: '[redacted]',
    });

    const request = items.find((item) => item.type === 'request');
    expect(request).toMatchObject({
      method: 'POST',
      host: 'api.example.com',
      path: '/v1/orders',
      statusCode: 503,
      networkType: 'wifi',
    });
    expect(request?.type === 'request' && request.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(items).toContainEqual(
      expect.objectContaining({ type: 'error', kind: 'hang', handled: true, fatal: false }),
    );
  });

  it('sends the full URL, content type and success body when the app opts in', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const platform = createFakePlatform({
      native: createNativeLikeBridge(null),
      fetchTarget: {
        fetch: async () =>
          new Response('{"status":false,"message":"Subscriber not found"}', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      },
    });
    const client = new ObservabilityClient(platform);
    client.configure({
      apiKey: 'pk_test',
      endpoint: 'https://obs.example.com',
      networkResponseBodies: 'all',
      networkFullUrls: true,
    });
    await flushMicrotasks();
    await platform.fetchTarget?.fetch?.('https://api.example.com/kyc/check?msisdn=231770000001');
    await vi.waitFor(async () => {
      await client.flush();
      expect(platform.sent.flatMap((envelope) => envelope.items)).toContainEqual(
        expect.objectContaining({ type: 'request' }),
      );
    });
    client.close();
    for (const envelope of platform.sent) {
      const parsed = parseEnvelope(envelope);
      expect(parsed.ok ? [] : parsed.issues).toEqual([]);
    }
    const request = platform.sent
      .flatMap((envelope) => envelope.items)
      .find((item) => item.type === 'request');
    expect(request).toMatchObject({
      statusCode: 200,
      url: 'https://api.example.com/kyc/check?msisdn=231770000001',
      contentType: 'application/json',
      responseBody: '{"status":false,"message":"Subscriber not found"}',
    });
  });

  it('never records Metro dev server traffic from a dev bundle', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const platform = createFakePlatform({
      native: createNativeLikeBridge(null),
      isDevBundle: true,
      devServerOrigin: () => 'http://192.168.1.2:8081',
      fetchTarget: { fetch: async () => new Response('{}', { status: 200 }) },
    });
    const client = new ObservabilityClient(platform);
    client.configure({
      apiKey: 'pk_test',
      endpoint: 'https://obs.example.com',
      dispatchInDebug: true,
    });
    await flushMicrotasks();
    const send = platform.fetchTarget?.fetch;
    await send?.('http://192.168.1.2:8081/symbolicate', { method: 'POST', body: '{}' });
    await send?.('http://192.168.1.2:8081/logs', { method: 'POST', body: '{}' });
    await send?.('http://10.0.2.2:8081/symbolicate', { method: 'POST', body: '{}' });
    await send?.('https://api.example.com/merchant/home');
    await client.flush();
    client.close();
    const paths = platform.sent
      .flatMap((envelope) => envelope.items)
      .flatMap((item) => (item.type === 'request' ? [`${item.host}${item.path}`] : []));
    expect(paths).toEqual(['api.example.com/merchant/home']);
  });

  it('opens an offline window when the app starts offline', async () => {
    const { client, platform } = await scenario({ networkConnected: false });
    await client.flush();
    client.close();
    const names = platform.sent
      .flatMap((envelope) => envelope.items)
      .flatMap((item) => (item.type === 'event' ? [item.name] : []));
    expect(names).toContain('$net.offline');
    expect(names).not.toContain('$net.online');
  });
});
