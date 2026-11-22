import { type SQL, type SQLWrapper, sql } from 'drizzle-orm';

/**
 * Keyset (cursor) pagination for telemetry tables.
 *
 * Offset pagination (`LIMIT 50 OFFSET 100000`) degrades linearly with depth —
 * Postgres must walk and discard every skipped row. Keyset pagination stays
 * constant-time because it seeks straight into the composite index that backs
 * the list ordering:
 *
 *   WHERE (sort_key, id) < (<cursor.sort>, <cursor.id>)
 *   ORDER BY sort_key DESC, id DESC
 *   LIMIT n
 *
 * The unique `id` tiebreaker is what makes pages stable and index-seekable,
 * which is why list indexes in the schema always include `id` as the last
 * column (e.g. `issues_project_status_last_seen_idx`).
 */
export interface Cursor {
  /** Sort key of the last row of the previous page (ISO string for timestamps). */
  sort: string;
  /** Unique tiebreaker of the last row of the previous page. */
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/** Returns null for absent or malformed cursors: the caller then starts from the top. */
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>;
    return typeof parsed.sort === 'string' &&
      typeof parsed.id === 'string' &&
      parsed.sort &&
      parsed.id
      ? { sort: parsed.sort, id: parsed.id }
      : null;
  } catch {
    return null;
  }
}

/**
 * WHERE fragment for descending keyset pagination. `sortType` is the Postgres
 * type of the sort column so the cursor value can be cast explicitly (e.g.
 * `timestamptz`, `text`, `int`).
 */
export function keysetCondition(
  sort: SQLWrapper,
  id: SQLWrapper,
  cursor: Cursor,
  sortType = 'text',
): SQL {
  return sql`(${sort}, ${id}) < (${cursor.sort}::${sql.raw(sortType)}, ${cursor.id})`;
}

/**
 * Builds the next cursor from a descending page that fetched `limit + 1`
 * rows; the extra row only signals `hasMore` and is not part of the page.
 */
export function nextCursor<Row extends { cursorSort: string | Date; cursorId: string | number }>(
  page: Row[],
  limit: number,
): { hasMore: boolean; cursor: Cursor | null } {
  if (page.length <= limit) return { hasMore: false, cursor: null };
  const last = page[limit - 1];
  return {
    hasMore: true,
    cursor: {
      sort:
        last.cursorSort instanceof Date ? last.cursorSort.toISOString() : String(last.cursorSort),
      id: String(last.cursorId),
    },
  };
}
