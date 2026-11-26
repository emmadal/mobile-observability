/** The Postgres SQLSTATE of an error, also when Drizzle wraps it as the `cause`. */
function sqlState(error: unknown): string | undefined {
  for (let current = error, depth = 0; current && depth < 3; depth += 1) {
    if (typeof current !== 'object') return undefined;
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** 23503: a row points at a parent that no longer exists (e.g. a deleted project). */
export function isForeignKeyViolation(error: unknown): boolean {
  return sqlState(error) === '23503';
}
