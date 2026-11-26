import 'server-only';

import { and, desc, eq, inArray, isNull, like, or } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { apiKeys, projects } from '@/db/schema';
import { slugify } from '@/lib/slug';
import { decodeCursor, encodeCursor, keysetCondition, nextCursor } from '@/server/db/keyset';
import { generateKey, type KeyKind } from '@/server/keys/keys';
import { clearKeyCache } from '@/server/keys/resolve';

export const PROJECTS_PAGE_SIZE = 20;

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  sdkEnabled: boolean;
  /** Public ingest key; null only if every key was revoked. */
  ingestKey: string | null;
  ingestKeyCreatedAt: Date | null;
  /** The upload token is a secret stored hashed: only its prefix can be shown again. */
  uploadToken: { prefix: string; createdAt: Date } | null;
}

export interface ProjectListPage {
  projects: ProjectSummary[];
  cursor: string | null;
  hasMore: boolean;
}

export interface CreatedProject {
  id: string;
  name: string;
  slug: string;
  ingestKey: string;
  uploadToken: string;
}

export class ProjectNotFoundError extends Error {
  constructor() {
    super('Project not found');
    this.name = 'ProjectNotFoundError';
  }
}

export class ProjectNameMismatchError extends Error {
  constructor() {
    super('The typed name does not match the project name');
    this.name = 'ProjectNameMismatchError';
  }
}

/** One page of projects, newest first, with their active keys. */
export async function listProjects(
  organizationId: string,
  rawCursor: string | null,
): Promise<ProjectListPage> {
  const db = getDb();
  const cursor = decodeCursor(rawCursor);
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      createdAt: projects.createdAt,
      sdkEnabled: projects.sdkEnabled,
      cursorSort: projects.createdAt,
      cursorId: projects.id,
    })
    .from(projects)
    .where(
      and(
        eq(projects.organizationId, organizationId),
        cursor
          ? keysetCondition(projects.createdAt, projects.id, cursor, 'timestamptz')
          : undefined,
      ),
    )
    .orderBy(desc(projects.createdAt), desc(projects.id))
    .limit(PROJECTS_PAGE_SIZE + 1);

  const page = rows.slice(0, PROJECTS_PAGE_SIZE);
  const { cursor: next, hasMore } = nextCursor(rows, PROJECTS_PAGE_SIZE);

  const keys =
    page.length > 0
      ? await db
          .select({
            projectId: apiKeys.projectId,
            kind: apiKeys.kind,
            publicKey: apiKeys.publicKey,
            prefix: apiKeys.keyPrefix,
            createdAt: apiKeys.createdAt,
          })
          .from(apiKeys)
          .where(
            and(
              inArray(
                apiKeys.projectId,
                page.map((project) => project.id),
              ),
              isNull(apiKeys.revokedAt),
            ),
          )
          .orderBy(desc(apiKeys.createdAt))
      : [];

  // Newest active key of each kind wins (rotation revokes the previous one).
  const ingestKeys = new Map<string, { key: string; createdAt: Date }>();
  const uploadTokens = new Map<string, { prefix: string; createdAt: Date }>();
  for (const key of keys) {
    if (key.kind === 'ingest' && key.publicKey && !ingestKeys.has(key.projectId)) {
      ingestKeys.set(key.projectId, { key: key.publicKey, createdAt: key.createdAt });
    } else if (key.kind === 'upload' && !uploadTokens.has(key.projectId)) {
      uploadTokens.set(key.projectId, { prefix: key.prefix, createdAt: key.createdAt });
    }
  }

  return {
    projects: page.map((project) => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
      createdAt: project.createdAt,
      sdkEnabled: project.sdkEnabled,
      ingestKey: ingestKeys.get(project.id)?.key ?? null,
      ingestKeyCreatedAt: ingestKeys.get(project.id)?.createdAt ?? null,
      uploadToken: uploadTokens.get(project.id) ?? null,
    })),
    cursor: next ? encodeCursor(next) : null,
    hasMore,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

/**
 * Creates a project with both keys. The slug is made unique inside the
 * organization; a concurrent insert with the same slug is retried.
 */
export async function createProject(input: {
  organizationId: string;
  userId: string;
  name: string;
}): Promise<CreatedProject> {
  const db = getDb();
  const ingest = generateKey('ingest');
  const upload = generateKey('upload');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.transaction(async (tx) => {
        const base = slugify(input.name, 44);
        const taken = await tx
          .select({ slug: projects.slug })
          .from(projects)
          .where(
            and(
              eq(projects.organizationId, input.organizationId),
              or(eq(projects.slug, base), like(projects.slug, `${base}-%`)),
            ),
          );
        const used = new Set(taken.map((row) => row.slug));
        let slug = base;
        for (let suffix = 2; used.has(slug) && suffix < 1_000; suffix += 1) {
          slug = `${base}-${suffix}`;
        }

        const [project] = await tx
          .insert(projects)
          // Explicit millisecond precision keeps the keyset cursor exact:
          // defaultNow() stores microseconds, which a JS Date cannot encode.
          .values({
            organizationId: input.organizationId,
            name: input.name,
            slug,
            createdAt: new Date(),
          })
          .returning({ id: projects.id, name: projects.name, slug: projects.slug });
        if (!project) throw new Error('Project insert returned no row');

        await tx.insert(apiKeys).values([
          {
            projectId: project.id,
            kind: 'ingest',
            keyHash: ingest.hash,
            keyPrefix: ingest.prefix,
            publicKey: ingest.key,
            createdBy: input.userId,
          },
          {
            projectId: project.id,
            kind: 'upload',
            keyHash: upload.hash,
            keyPrefix: upload.prefix,
            createdBy: input.userId,
          },
        ]);

        return { ...project, ingestKey: ingest.key, uploadToken: upload.key };
      });
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === 2) throw error;
    }
  }
  throw new Error('Could not create the project');
}

/**
 * Revokes the active key of `kind` and issues a new one. The key cache is
 * cleared so the old key is rejected immediately in this process; other
 * instances stop accepting it within the 30 s cache TTL (AC-30: ≤ 60 s).
 */
export async function rotateKey(input: {
  organizationId: string;
  projectId: string;
  kind: KeyKind;
  userId: string;
}): Promise<string> {
  const generated = generateKey(input.kind);
  await getDb().transaction(async (tx) => {
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(eq(projects.id, input.projectId), eq(projects.organizationId, input.organizationId)),
      )
      .limit(1);
    if (!project) throw new ProjectNotFoundError();

    await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiKeys.projectId, project.id),
          eq(apiKeys.kind, input.kind),
          isNull(apiKeys.revokedAt),
        ),
      );

    await tx.insert(apiKeys).values({
      projectId: project.id,
      kind: input.kind,
      keyHash: generated.hash,
      keyPrefix: generated.prefix,
      publicKey: input.kind === 'ingest' ? generated.key : null,
      createdBy: input.userId,
    });
  });

  clearKeyCache();
  return generated.key;
}

/**
 * Permanently deletes a project and all of its data. Every table holding
 * project data (keys, sessions, errors, issues, events, requests, metrics,
 * endpoint templates, source maps, alert rules) references projects with
 * ON DELETE CASCADE, so this one delete removes everything atomically.
 * The caller must type the project's exact name.
 */
export async function deleteProject(input: {
  organizationId: string;
  projectId: string;
  confirmName: string;
}): Promise<{ name: string }> {
  const deleted = await getDb().transaction(async (tx) => {
    const [project] = await tx
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(
        and(eq(projects.id, input.projectId), eq(projects.organizationId, input.organizationId)),
      )
      .for('update')
      .limit(1);
    if (!project) throw new ProjectNotFoundError();
    if (input.confirmName.trim() !== project.name) throw new ProjectNameMismatchError();

    await tx.delete(projects).where(eq(projects.id, project.id));
    return project;
  });

  // Its keys stop working in this process now; other instances get a 401 on
  // their next write (the foreign key fails) and drop the key within the TTL.
  clearKeyCache();
  return { name: deleted.name };
}
