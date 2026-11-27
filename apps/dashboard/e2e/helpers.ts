import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import type { APIRequestContext, Page } from '@playwright/test';

export interface Seed {
  email: string;
  password: string;
  projectId: string;
  ingestKey: string;
}

export function readSeed(): Seed {
  return JSON.parse(readFileSync('e2e/.cache/seed.json', 'utf8')) as Seed;
}

/**
 * Console errors and uncaught exceptions of a page: a CSP violation (inline
 * style or script without the nonce) shows up here.
 */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Posts one gzipped envelope to the ingest endpoint, as the SDK does. */
export async function sendEnvelope(
  request: APIRequestContext,
  ingestKey: string,
  envelope: Record<string, unknown>,
): Promise<void> {
  const response = await request.post('/api/v1/envelope', {
    headers: {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
      'x-mobs-key': ingestKey,
    },
    data: gzipSync(JSON.stringify({ ...envelope, sentAt: Date.now() })),
  });
  if (response.status() !== 202) {
    throw new Error(`ingest answered ${response.status()}: ${await response.text()}`);
  }
}
