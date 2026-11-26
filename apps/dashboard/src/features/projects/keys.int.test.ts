import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  alertRules,
  apiKeys,
  endpointTemplates,
  errorEvents,
  issues,
  logEvents,
  member,
  metrics,
  organization,
  projects,
  requests,
  sessions,
  sourceMaps,
  user,
} from '@/db/schema';
import { handleEnvelope } from '@/server/ingest/handle-envelope';
import { RateLimiter } from '@/server/ingest/rate-limit';
import { resolveKey } from '@/server/keys/resolve';
import { db, envelope, errorItem, ingestRequest, resetDatabase } from '../../../test/fixtures';
import {
  type CreatedProject,
  createProject,
  deleteProject,
  listProjects,
  ProjectNameMismatchError,
  ProjectNotFoundError,
  rotateKey,
} from './service';

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

describe('listing projects with their keys', () => {
  it('shows the ingest key in full and only the prefix of the secret upload token', async () => {
    const created = await createProject({ ...org, name: 'Shop' });
    const [listed] = (await listProjects(org.organizationId, null)).projects;
    expect(listed?.ingestKey).toBe(created.ingestKey);
    expect(listed?.ingestKeyCreatedAt).toBeInstanceOf(Date);
    expect(listed?.uploadToken?.prefix).toBe(created.uploadToken.slice(0, 'mobs_sk_'.length + 6));
    expect(listed?.uploadToken?.createdAt).toBeInstanceOf(Date);
    expect(JSON.stringify(listed)).not.toContain(created.uploadToken);
  });
});

describe('project deletion', () => {
  const projectTables = {
    apiKeys,
    sessions,
    errorEvents,
    issues,
    logEvents,
    requests,
    metrics,
    endpointTemplates,
    sourceMaps,
    alertRules,
  } as const;

  async function rowCounts(projectId: string): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const [name, table] of Object.entries(projectTables)) {
      const [row] = await db
        .select({ rows: sql<number>`count(*)::int` })
        .from(table)
        .where(eq(table.projectId, projectId));
      counts[name] = Number(row?.rows ?? 0);
    }
    return counts;
  }

  /** One row of every kind of project data. */
  async function fill(project: CreatedProject): Promise<void> {
    const now = Date.now();
    const sessionId = `s-${project.id}`;
    const response = await handleEnvelope(
      ingestRequest(
        project.ingestKey,
        envelope([
          {
            type: 'session',
            sessionId,
            startedAt: now - 5_000,
            status: 'ok',
            errorCount: 0,
            init: true,
          },
          errorItem({ sessionId }),
          {
            type: 'event',
            eventId: `e-${project.id}`,
            timestamp: now - 1_000,
            name: 'checkout',
            severity: 'info',
          },
          {
            type: 'request',
            eventId: `r-${project.id}`,
            timestamp: now - 1_000,
            method: 'GET',
            host: 'api.example.com',
            path: '/items/1',
            statusCode: 200,
            durationMs: 120,
          },
          {
            type: 'metric',
            eventId: `m-${project.id}`,
            timestamp: now - 1_000,
            name: 'app_startup.ttr',
            valueMs: 900,
          },
        ]),
      ),
      db,
      { limiter: new RateLimiter(1_000, 1_000) },
    );
    expect(response.status).toBe(202);
    await db.insert(sourceMaps).values({
      projectId: project.id,
      platform: 'ios',
      bundleKey: 'build:1.0.0+1',
      fileName: 'main.jsbundle.map',
      content: Buffer.from('{}'),
      sizeBytes: 2,
    });
    await db
      .insert(alertRules)
      .values({ projectId: project.id, metric: 'crash_free_rate', window: '1h', threshold: 0.99 });
  }

  it('deletes the project and every row of its data, and nothing else', async () => {
    const doomed = await createProject({ ...org, name: 'Shop' });
    const kept = await createProject({ ...org, name: 'Courier' });
    await fill(doomed);
    await fill(kept);
    expect(Object.values(await rowCounts(doomed.id)).every((rows) => rows > 0)).toBe(true);

    await deleteProject({
      organizationId: org.organizationId,
      projectId: doomed.id,
      confirmName: 'Shop',
    });

    expect(await db.select().from(projects).where(eq(projects.id, doomed.id))).toEqual([]);
    expect(Object.values(await rowCounts(doomed.id))).toEqual(
      Object.keys(projectTables).map(() => 0),
    );
    expect(Object.values(await rowCounts(kept.id)).every((rows) => rows > 0)).toBe(true);
  });

  it('stops accepting the deleted project keys right away, even cached ones', async () => {
    const project = await createProject({ ...org, name: 'Shop' });
    expect((await sendEnvelope(project.ingestKey)).status).toBe(202);
    await deleteProject({
      organizationId: org.organizationId,
      projectId: project.id,
      confirmName: 'Shop',
    });
    expect((await sendEnvelope(project.ingestKey)).status).toBe(401);
    expect(await resolveKey(db, project.uploadToken, 'upload')).toBeNull();
  });

  it('answers 401, not a server error, when another instance still caches the key', async () => {
    const project = await createProject({ ...org, name: 'Shop' });
    expect((await sendEnvelope(project.ingestKey)).status).toBe(202);
    // Deleted without clearing this process's cache, like a delete on another instance.
    await db.delete(projects).where(eq(projects.id, project.id));
    const response = await handleEnvelope(
      ingestRequest(project.ingestKey, envelope([errorItem()])),
      db,
      { limiter: new RateLimiter(1_000, 1_000) },
    );
    expect(response.status).toBe(401);
  });

  it('requires the exact project name', async () => {
    const project = await createProject({ ...org, name: 'Shop' });
    await expect(
      deleteProject({
        organizationId: org.organizationId,
        projectId: project.id,
        confirmName: 'shop',
      }),
    ).rejects.toBeInstanceOf(ProjectNameMismatchError);
    expect(await db.select().from(projects).where(eq(projects.id, project.id))).toHaveLength(1);
  });

  it('does not delete a project from another organization', async () => {
    const other = await createOrg();
    const project = await createProject({ ...other, name: 'Shop' });
    await expect(
      deleteProject({
        organizationId: org.organizationId,
        projectId: project.id,
        confirmName: 'Shop',
      }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
    expect(await db.select().from(projects).where(eq(projects.id, project.id))).toHaveLength(1);
  });
});
