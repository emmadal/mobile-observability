import { and, desc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { metrics } from '@/db/schema';
import { createTestProject, db, resetDatabase, type TestProject } from '../../../test/fixtures';
import { decodeCursor, encodeCursor, keysetCondition, nextCursor } from './keyset';

const PAGE = 3;

/** Descending `timestamp` page over metrics, ordered with the keyset tiebreaker. */
async function page(projectId: string, cursor: string | null) {
  const decoded = decodeCursor(cursor);
  const rows = await db
    .select({
      id: metrics.id,
      timestamp: metrics.timestamp,
      // Alias the sort key so nextCursor can read it without knowing the column.
      cursorSort: metrics.timestamp,
      cursorId: metrics.id,
    })
    .from(metrics)
    .where(
      and(
        eq(metrics.projectId, projectId),
        decoded
          ? keysetCondition(metrics.timestamp, metrics.id, decoded, 'timestamptz')
          : undefined,
      ),
    )
    .orderBy(desc(metrics.timestamp), desc(metrics.id))
    .limit(PAGE + 1);
  return { rows: rows.slice(0, PAGE), ...nextCursor(rows, PAGE) };
}

let project: TestProject;

beforeEach(async () => {
  await resetDatabase();
  project = await createTestProject('Keyset');
  const base = Date.UTC(2026, 0, 1, 12, 0, 0);
  await db.insert(metrics).values(
    Array.from({ length: 5 }, (_, index) => ({
      projectId: project.projectId,
      eventId: `evt-${index}`,
      timestamp: new Date(base + index * 1_000),
      installationId: 'install-1',
      platform: 'ios' as const,
      appVersion: '1.0.0',
      appBuild: '1',
      environment: 'production',
      name: 'cold_launch',
      valueMs: 100 + index,
    })),
  );
});

describe('keyset pagination', () => {
  it('walks a descending list with stable, constant-time pages', async () => {
    const first = await page(project.projectId, null);
    expect(first.rows).toHaveLength(3);
    expect(first.hasMore).toBe(true);
    expect(first.cursor).not.toBeNull();
    if (!first.cursor) throw new Error('cursor missing after a full page');

    const second = await page(project.projectId, encodeCursor(first.cursor));
    expect(second.rows).toHaveLength(2);
    expect(second.hasMore).toBe(false);
    expect(second.cursor).toBeNull();

    // No row appears twice and none is skipped.
    const ids = [...first.rows, ...second.rows].map((row) => row.id);
    expect(new Set(ids).size).toBe(5);
    const times = [first.rows, second.rows].flat().map((row) => row.timestamp.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('round-trips cursors and rejects malformed input', () => {
    const cursor = { sort: '2026-01-01T12:00:02.000Z', id: '42' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor('not-base64!')).toBeNull();
    expect(decodeCursor(encodeCursor({ sort: '', id: '42' }))).toBeNull();
    expect(decodeCursor(encodeCursor({ sort: 'x', id: 1 as unknown as string }))).toBeNull();
  });

  it('returns an empty page for a project without rows', async () => {
    const empty = await createTestProject('Empty');
    const result = await page(empty.projectId, null);
    expect(result.rows).toHaveLength(0);
    expect(result.hasMore).toBe(false);
  });
});
