import { gzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import { errorEvents } from '@/db/schema';
import { handleEnvelope } from '@/server/ingest/handle-envelope';
import { RateLimiter } from '@/server/ingest/rate-limit';
import {
  createTestProject,
  db,
  envelope,
  errorItem,
  ingestRequest,
  resetDatabase,
  type TestProject,
} from '../../../test/fixtures';
import { fixtureMap } from '../../../test/sourcemap-fixture';
import { handleSourceMapUpload } from './handle-upload';

let project: TestProject;

beforeEach(async () => {
  await resetDatabase();
  project = await createTestProject();
});

const upload = (
  token: string,
  query: string,
  body: Uint8Array | string,
  headers: Record<string, string> = {},
) =>
  handleSourceMapUpload(
    new Request(`http://localhost/api/v1/sourcemaps?${query}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, ...headers },
      body,
    }),
    db,
  );

describe('POST /api/v1/sourcemaps', () => {
  it('rejects the public ingest key and invalid parameters', async () => {
    expect(
      (await upload(project.ingestKey, 'platform=ios&bundleKey=update:u1', fixtureMap())).status,
    ).toBe(401);
    expect(
      (await upload(project.uploadToken, 'platform=web&bundleKey=update:u1', fixtureMap())).status,
    ).toBe(400);
    expect(
      (await upload(project.uploadToken, 'platform=ios&bundleKey=../../etc', fixtureMap())).status,
    ).toBe(400);
    expect(
      (await upload(project.uploadToken, 'platform=ios&bundleKey=update:u1', '{"not":"a map"}'))
        .status,
    ).toBe(400);
  });

  it('symbolicates errors from the uploaded update bundle (AC-19)', async () => {
    const response = await upload(
      project.uploadToken,
      'platform=android&bundleKey=update:0f3c1d2e-1111-4222-8333-444455556666&fileName=index.android.bundle.map',
      new Uint8Array(gzipSync(fixtureMap())),
      { 'content-encoding': 'gzip' },
    );
    expect(response.status).toBe(201);

    await handleEnvelope(
      ingestRequest(
        project.ingestKey,
        envelope(
          [
            errorItem({
              exception: {
                type: 'TypeError',
                message: 'x',
                frames: [{ function: 'a', file: 'index.android.bundle', line: 1, column: 101 }],
              },
            }),
          ],
          {
            app: {
              version: '1.0.0',
              build: '1',
              updateId: '0f3c1d2e-1111-4222-8333-444455556666',
              isEmbeddedLaunch: false,
              environment: 'production',
            },
            device: { platform: 'android', osVersion: '16' },
          },
        ),
      ),
      db,
      { limiter: new RateLimiter(1_000, 1_000) },
    );
    const [event] = await db.select().from(errorEvents);
    expect(event?.symbolicatedFrames?.[0]).toMatchObject({
      file: 'src/cart.ts',
      line: 12,
      function: 'computeCartTotal',
    });
  });
});
