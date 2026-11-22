import { randomUUID } from 'node:crypto';
import {
  CURRENT_SCHEMA_VERSION,
  type EnvelopeInput,
  type ItemInput,
} from '@mobile-observability/protocol';
import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { apiKeys, organization, projects } from '@/db/schema';
import { generateKey } from '@/server/keys/keys';
import { clearKeyCache } from '@/server/keys/resolve';

export const db = getDb();

export async function resetDatabase(): Promise<void> {
  await db.execute(sql`truncate table organization, "user", projects cascade`);
  clearKeyCache();
}

export interface TestProject {
  projectId: string;
  organizationId: string;
  ingestKey: string;
  uploadToken: string;
}

export async function createTestProject(name = 'Shop'): Promise<TestProject> {
  const organizationId = randomUUID();
  await db.insert(organization).values({
    id: organizationId,
    name: `${name} org`,
    slug: `org-${organizationId}`,
    createdAt: new Date(),
  });
  const [project] = await db
    .insert(projects)
    .values({ organizationId, name, slug: name.toLowerCase() })
    .returning({ id: projects.id });
  if (!project) throw new Error('project not created');
  const ingest = generateKey('ingest');
  const upload = generateKey('upload');
  await db.insert(apiKeys).values([
    {
      projectId: project.id,
      kind: 'ingest',
      keyHash: ingest.hash,
      keyPrefix: ingest.prefix,
      publicKey: ingest.key,
    },
    { projectId: project.id, kind: 'upload', keyHash: upload.hash, keyPrefix: upload.prefix },
  ]);
  return { projectId: project.id, organizationId, ingestKey: ingest.key, uploadToken: upload.key };
}

export function envelope(
  items: ItemInput[],
  overrides: Partial<EnvelopeInput> = {},
): EnvelopeInput {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    sentAt: Date.now(),
    sdk: { name: '@mobile-observability/react-native', version: '0.1.0' },
    installationId: 'install-1',
    app: { version: '1.2.0', build: '42', environment: 'production' },
    device: { platform: 'ios', osVersion: '26.1', model: 'iPhone18,1' },
    items,
    ...overrides,
  };
}

export const CART_FRAMES = [
  { function: 'computeCartTotal', file: 'src/cart.ts', line: 12, column: 5 },
  { function: 'onPress', file: 'src/screens/checkout.tsx', line: 40, column: 9 },
];

let counter = 0;
export function errorItem(
  overrides: Partial<Extract<ItemInput, { type: 'error' }>> = {},
): ItemInput {
  counter += 1;
  return {
    type: 'error',
    eventId: randomUUID(),
    timestamp: Date.now() - counter,
    origin: 'js',
    kind: 'exception',
    fatal: false,
    handled: false,
    exception: {
      type: 'TypeError',
      message: "Cannot read property 'items' of undefined",
      frames: CART_FRAMES,
    },
    breadcrumbs: [],
    ...overrides,
  };
}

export function ingestRequest(
  key: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request('http://localhost/api/v1/envelope', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mobs-key': key, ...headers },
    body: toBody(body),
  });
}

/** Request bodies need an ArrayBuffer-backed view; Node Buffers are copied into one. */
export function toBody(body: unknown): BodyInit {
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return new Blob([new Uint8Array(body)]);
  return JSON.stringify(body);
}
