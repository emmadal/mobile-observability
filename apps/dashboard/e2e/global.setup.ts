import { expect, test as setup } from '@playwright/test';
import { readSeed, sendEnvelope } from './helpers';

/**
 * Signs the demo owner in once (stored state for every spec) and sends the
 * telemetry the specs read, the way SDK 0.2 and 0.3 apps send it.
 */
setup('sign in and send telemetry', async ({ page, request }) => {
  const seed = readSeed();

  await page.goto('/login');
  await page.getByLabel('Email').fill(seed.email);
  await page.getByLabel('Password').fill(seed.password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.context().storageState({ path: 'e2e/.cache/owner.json' });

  const now = Date.now();
  const minutesAgo = (minutes: number) => now - minutes * 60_000;
  const users = [
    { install: 'install-kyc-1', id: 'kyc:231770000001', phone: '231770000001', segment: 'kyc' },
    { install: 'install-kyc-2', id: 'kyc:231770000002', phone: '231770000002', segment: 'kyc' },
    // A 0.2 SDK: only an id, the segment comes from its prefix.
    { install: 'install-kya-1', id: 'kya:231880000003' },
    {
      install: 'install-merchant-1',
      id: 'merchant:231880000004',
      phone: '231880000004',
      segment: 'merchant',
    },
    { install: 'install-ftth-1', id: 'ftth:0886000005', phone: '0886000005', segment: 'ftth' },
  ];

  for (const [index, { install, ...user }] of users.entries()) {
    const sessionId = crypto.randomUUID();
    const base = {
      schemaVersion: 1,
      sdk: { name: '@mobile-observability/react-native', version: '0.3.0' },
      installationId: install,
      app: { version: '2.4.0', build: '57', environment: 'production' },
      device: { platform: 'android', osVersion: '15', model: 'SM-A155F', manufacturer: 'samsung' },
    };
    // The session starts before sign-in, anonymous.
    await sendEnvelope(request, seed.ingestKey, {
      ...base,
      items: [
        {
          type: 'session',
          sessionId,
          startedAt: minutesAgo(50 - index),
          status: 'ok',
          errorCount: 0,
          init: true,
        },
      ],
    });
    const request_ = (minutes: number, extra: Record<string, unknown>) => ({
      type: 'request',
      eventId: crypto.randomUUID(),
      timestamp: minutesAgo(minutes),
      sessionId,
      method: 'POST',
      host: 'kyc.example.lr',
      durationMs: 640,
      ...extra,
    });
    // Later items carry the signed-in user.
    await sendEnvelope(request, seed.ingestKey, {
      ...base,
      user,
      items: [
        // SDK 0.4 with networkFullUrls and networkResponseBodies: 'all'.
        request_(40 - index, {
          path: '/agent/login',
          statusCode: 200,
          networkType: 'cellular',
          url: 'https://kyc.example.lr/agent/login?lang=en&pin=[redacted]',
          contentType: 'application/json',
          responseBody: '{"status":true,"message":"Welcome back","token":"[redacted]"}',
        }),
        ...(user.segment === 'merchant'
          ? [
              request_(35, {
                path: '/SmallMerchant/create',
                statusCode: 200,
                routeName: '/(merchant)/home',
                url: 'https://kyc.example.lr/SmallMerchant/create',
                contentType: 'application/json',
                responseBody: '{"status":false,"message":"QR code already assigned"}',
              }),
            ]
          : []),
        request_(30 - index, {
          path: '/customers/add',
          statusCode: 422,
          routeName: '(kyc)/register',
          traceId: `4bf92f3577b34da6a3ce929d0e0e47${10 + index}`,
          responseBody: '{"message":"MSISDN already registered","token":"[redacted]"}',
        }),
        request_(20 - index, {
          path: '/agent/statistics',
          statusCode: 0,
          error: 'network error',
          errorMessage: 'Unable to resolve host "kyc.example.lr"',
        }),
        ...(index === 0
          ? [
              {
                type: 'error',
                eventId: crypto.randomUUID(),
                timestamp: minutesAgo(15),
                sessionId,
                origin: 'js',
                kind: 'exception',
                fatal: false,
                handled: true,
                exception: {
                  type: 'TypeError',
                  message: "Cannot read property 'msisdn' of undefined",
                  frames: [
                    { function: 'submitCustomer', file: 'app/(kyc)/register.tsx', line: 42 },
                  ],
                },
                breadcrumbs: [],
              },
            ]
          : []),
      ],
    });
  }
});
