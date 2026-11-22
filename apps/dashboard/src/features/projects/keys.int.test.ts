import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { member, organization, user } from '@/db/schema';
import { handleEnvelope } from '@/server/ingest/handle-envelope';
import { RateLimiter } from '@/server/ingest/rate-limit';
import { resolveKey } from '@/server/keys/resolve';
import { db, envelope, ingestRequest, resetDatabase } from '../../../test/fixtures';
import { createProject, listProjects, ProjectNotFoundError, rotateKey } from './service';

interface TestOrg {
  userId: string;
  organizationId: string;
}

async function createOrg(role = 'owner'): Promise<TestOrg> {
  const userId = randomUUID();
  const organizationId = randomUUID();
  const now = new Date();
  await db.insert(user).values({
    id: userId,
    name: 'Owner',
    email: `${userId}@test.local`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(organization).values({
    id: organizationId,
    name: 'Test org',
    slug: `org-${organizationId}`,
    createdAt: now,
  });
  await db.insert(member).values({
    id: randomUUID(),
    organizationId,
    userId,
    role,
    createdAt: now,
  });
  return { userId, organizationId };
}

let org: TestOrg;

beforeEach(async () => {
  await resetDatabase();
  org = await createOrg();
});

const sendEnvelope = (key: string) =>
  handleEnvelope(ingestRequest(key, envelope([])), db, {
    limiter: new RateLimiter(1_000, 1_000),
  });

describe('project keys (AC-30)', () => {
  it('rejects a rotated ingest key immediately, even when it was cached', async () => {
    const project = await createProject({ ...org, name: 'Shop' });

    // Warm the key cache, then rotate in the same process.
    expect((await sendEnvelope(project.ingestKey)).status).toBe(202);
    const nextKey = await rotateKey({
      ...org,
      projectId: project.id,
      kind: 'ingest',
    });

    expect(nextKey).not.toBe(project.ingestKey);
    expect((await sendEnvelope(project.ingestKey)).status).toBe(401);
    expect((await sendEnvelope(nextKey)).status).toBe(202);
  });

  it('replaces the upload token and keeps the old one invalid', async () => {
    const project = await createProject({ ...org, name: 'Shop' });
    expect(await resolveKey(db, project.uploadToken, 'upload')).not.toBeNull();

    const nextToken = await rotateKey({
      ...org,
      projectId: project.id,
      kind: 'upload',
    });

    expect(await resolveKey(db, project.uploadToken, 'upload')).toBeNull();
    expect(await resolveKey(db, nextToken, 'upload')).not.toBeNull();
  });

  it('does not rotate a project from another organization', async () => {
    const project = await createProject({ ...org, name: 'Shop' });
    const other = await createOrg();

    await expect(
      rotateKey({ ...other, projectId: project.id, kind: 'ingest' }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
    expect(await resolveKey(db, project.ingestKey, 'ingest')).not.toBeNull();
  });

  it('gives projects unique slugs inside the organization', async () => {
    const first = await createProject({ ...org, name: 'My App' });
    const second = await createProject({ ...org, name: 'My App' });
    expect(first.slug).toBe('my-app');
    expect(second.slug).toBe('my-app-2');
  });

  it('pages projects with a stable keyset cursor', async () => {
    for (let index = 0; index < 21; index += 1) {
      await createProject({ ...org, name: `App ${index}` });
    }

    const first = await listProjects(org.organizationId, null);
    expect(first.projects).toHaveLength(20);
    expect(first.hasMore).toBe(true);
    expect(first.cursor).not.toBeNull();

    const second = await listProjects(org.organizationId, first.cursor);
    expect(second.projects).toHaveLength(1);
    expect(second.hasMore).toBe(false);

    const ids = new Set([...first.projects, ...second.projects].map((project) => project.id));
    expect(ids.size).toBe(21);
  });
});
