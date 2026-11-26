import { describe, expect, it } from 'vitest';
import { appEnv, envLine, MOBS_ENV } from './env-snippet';

describe('env snippets', () => {
  it('gives the app only the dashboard URL and the public ingest key', () => {
    expect(appEnv('https://obs.example.com/', 'mobs_pk_abc')).toBe(
      'EXPO_PUBLIC_MOBS_ENDPOINT=https://obs.example.com\nEXPO_PUBLIC_MOBS_KEY=mobs_pk_abc',
    );
  });

  it('keeps the upload token out of EXPO_PUBLIC_ variables', () => {
    expect(MOBS_ENV.uploadToken).toBe('MOBS_UPLOAD_TOKEN');
    expect(MOBS_ENV.uploadToken.startsWith('EXPO_PUBLIC_')).toBe(false);
    expect(envLine('uploadToken', 'mobs_sk_secret')).toBe('MOBS_UPLOAD_TOKEN=mobs_sk_secret');
  });
});
