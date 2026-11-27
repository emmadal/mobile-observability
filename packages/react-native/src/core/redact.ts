/**
 * Sensitive values never leave the device. Keys that look like credentials,
 * payment data or personal identifiers have their value replaced before the
 * item is queued (rule from the security checklist: passwords, OTPs, tokens,
 * card numbers and personal identifiers are never sent).
 */
const SENSITIVE_KEY_PATTERN =
  /pass(word)?|pwd|secret|token|otp|one[-_]?time|authorization|bearer|api[-_]?key|credential|card|cvv|cvc|ssn|social[-_]?security/i;

const REDACTED = '[redacted]';

/** Words of a camelCase, snake_case or kebab-case key, lowercased. */
function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/);
}

export function isSensitiveKey(key: string): boolean {
  if (SENSITIVE_KEY_PATTERN.test(key)) return true;
  // A PIN is a credential, but "pin" inside a word (shipping, mapping) is not.
  return keyWords(key).some((word) => word === 'pin' || word === 'pincode');
}

/** Returns a copy where every sensitive top-level key is redacted. */
export function redactSensitive(values: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    result[key] = isSensitiveKey(key) ? REDACTED : value;
  }
  return result;
}

const MAX_REDACT_DEPTH = 8;

/** Copy of a parsed JSON value with sensitive keys redacted at every level (depth-capped). */
export function redactDeep(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_REDACT_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((entry) => redactDeep(entry, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = isSensitiveKey(key) ? REDACTED : redactDeep(entry, depth + 1);
  }
  return result;
}

/** `"token": "abc"` style pairs in text that could not be parsed as JSON. */
const SENSITIVE_PAIR =
  /("(?:[^"]*(?:pass(?:word)?|pwd|secret|token|otp|authorization|bearer|api[-_]?key|credential|card|cvv|cvc|ssn)[^"]*|(?:[^"]*[-_])?pin(?:code)?)"\s*:\s*)("(?:[^"\\]|\\.)*"|[^,}\s]+)/gi;

/** Largest body parsed as JSON; longer bodies get the text-level redaction only. */
const MAX_PARSED_BODY = 64 * 1024;

/**
 * Error response body as sent to the server: JSON is re-serialized with
 * sensitive keys redacted, other text has `"key": value` pairs redacted, and
 * the result is cut to `maxLength`. Undefined for an empty body.
 */
export function sanitizeResponseBody(text: string, maxLength: number): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= MAX_PARSED_BODY && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
    try {
      return JSON.stringify(redactDeep(JSON.parse(trimmed))).slice(0, maxLength);
    } catch {
      // Not JSON after all: fall through to the text redaction.
    }
  }
  return trimmed.replace(SENSITIVE_PAIR, `$1"${REDACTED}"`).slice(0, maxLength);
}
