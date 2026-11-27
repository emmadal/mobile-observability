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

/*
 * Key/value shapes found in bodies that are not parseable JSON (HTML error
 * pages, form-encoded or XML bodies, JSON too long or cut short). Every key
 * found is tested with isSensitiveKey, the same test the JSON path uses, so
 * both paths redact the same keys.
 */
/** `"key": value` (JSON-like text). */
const QUOTED_PAIR =
  /("((?:[^"\\]|\\.){1,128})"\s*:\s*)("(?:[^"\\]|\\.)*"|"(?:[^"\\]|\\.)*$|[^,}\]\s]+)/g;
/** `key=value` (form-encoded or query-like text). */
const FORM_PAIR = /(^|[?&;\s])([\w.[\]-]{1,128})=([^&;\s]*)/g;
/** `<key>value</key>` (XML), or `<key>value` running to the end of the scanned text. */
const XML_ELEMENT = /<([A-Za-z_][\w.-]{0,127})(\s[^>]*)?>([^<]*)(?:<\/\1>|$)/g;

function redactText(text: string): string {
  return text
    .replace(QUOTED_PAIR, (match, prefix: string, key: string) =>
      isSensitiveKey(key) ? `${prefix}"${REDACTED}"` : match,
    )
    .replace(FORM_PAIR, (match, lead: string, key: string) =>
      isSensitiveKey(key) ? `${lead}${key}=${REDACTED}` : match,
    )
    .replace(XML_ELEMENT, (match, tag: string, attributes: string | undefined) =>
      isSensitiveKey(tag) ? `<${tag}${attributes ?? ''}>${REDACTED}</${tag}>` : match,
    );
  // A value cut by the scan limit has no closing quote or tag: the patterns
  // above then redact it through to the end of the scanned text.
}

/** Largest body parsed as JSON; longer bodies get the text-level redaction only. */
const MAX_PARSED_BODY = 64 * 1024;

/**
 * Error response body as sent to the server: JSON is re-serialized with
 * sensitive keys redacted at every level; other text has its JSON-like,
 * form-encoded and XML key/value pairs redacted with the same key test. The
 * result is cut to `maxLength`. Undefined for an empty body.
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
  // Only the kept prefix (with room for a value cut at the edge) is scanned.
  return redactText(trimmed.slice(0, maxLength * 2)).slice(0, maxLength);
}
