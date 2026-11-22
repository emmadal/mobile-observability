import type { JsonObject, JsonValue } from '../types';

const MAX_DEPTH = 6;

/** Keeps only JSON-serializable values (drops Date, undefined, functions, cycles). */
export function toJsonValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): JsonValue | undefined {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : undefined;
    case 'object': {
      if (depth >= MAX_DEPTH || seen.has(value) || value instanceof Date) return undefined;
      seen.add(value);
      if (Array.isArray(value)) {
        return value
          .map((entry) => toJsonValue(entry, depth + 1, seen))
          .filter((entry): entry is JsonValue => entry !== undefined);
      }
      return toJsonObject(value as Record<string, unknown>, depth + 1, seen);
    }
    default:
      return undefined;
  }
}

export function toJsonObject(
  value: Record<string, unknown>,
  depth = 0,
  seen = new WeakSet<object>(),
): JsonObject {
  const result: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    const converted = toJsonValue(entry, depth, seen);
    if (converted !== undefined) result[key] = converted;
  }
  return result;
}
