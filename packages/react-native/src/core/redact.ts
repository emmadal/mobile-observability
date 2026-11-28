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

/** `"key":` followed by an object or array value. */
const KEY_BEFORE_CONTAINER = /"((?:[^"\\]|\\.){1,128})"\s*:\s*(?=[{[])/g;

/** Index just past the object or array starting at `start`; the text's end when it is cut. */
function endOfContainer(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === '\\') index += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === '{' || char === '[') {
      depth += 1;
    } else if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return text.length;
}

/**
 * Replaces the whole object or array value of every sensitive key, so text
 * that cannot be parsed (a body too long, or cut short) loses the same
 * values as parsed JSON does: `"card": {"number": "4111..."}` keeps nothing.
 */
function redactContainers(text: string): string {
  let result = '';
  let copied = 0;
  KEY_BEFORE_CONTAINER.lastIndex = 0;
  for (
    let match = KEY_BEFORE_CONTAINER.exec(text);
    match;
    match = KEY_BEFORE_CONTAINER.exec(text)
  ) {
    if (!isSensitiveKey(match[1] ?? '')) continue;
    const valueStart = match.index + match[0].length;
    const valueEnd = endOfContainer(text, valueStart);
    result += `${text.slice(copied, valueStart)}"${REDACTED}"`;
    copied = valueEnd;
    KEY_BEFORE_CONTAINER.lastIndex = valueEnd;
  }
  return result + text.slice(copied);
}

function redactText(text: string): string {
  return redactContainers(text)
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
 * Response body as sent to the server: JSON is re-serialized with
 * sensitive keys redacted at every level; other text has its JSON-like,
 * form-encoded and XML key/value pairs redacted with the same key test. The
 * result is cut to `maxLength`. Undefined for an empty body.
 */
export function sanitizeResponseBody(text: string, maxLength: number): string | undefined {
  // A body too long to parse is only ever scanned through a bounded window, so
  // a large success response costs no more than a small one.
  const parseable = text.length <= MAX_PARSED_BODY;
  const trimmed = (parseable ? text : text.slice(0, maxLength * 2 + 1024)).trim();
  if (!trimmed) return undefined;
  if (parseable && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
    try {
      return JSON.stringify(redactDeep(JSON.parse(trimmed))).slice(0, maxLength);
    } catch {
      // Not JSON after all: fall through to the text redaction.
    }
  }
  // Only the kept prefix (with room for a value cut at the edge) is scanned.
  return redactText(trimmed.slice(0, maxLength * 2)).slice(0, maxLength);
}

const URL_PREFIX = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*@)?/i;

/**
 * Full URL as sent to the server: user info and fragment dropped, and the
 * value of every query parameter whose key looks like a credential (`token`,
 * `pin`, `otp`, `password`...) redacted with the same key test as bodies.
 * The path is kept as called. Cut to `maxLength`.
 */
export function redactUrl(url: string, maxLength: number): string {
  const withoutFragment = url.split('#', 1)[0] ?? '';
  const withoutUser = withoutFragment.replace(URL_PREFIX, '$1');
  const queryStart = withoutUser.indexOf('?');
  if (queryStart === -1) return withoutUser.slice(0, maxLength);
  // Pairs split on `&` and `;` (both are used as separators), delimiters kept.
  const query = withoutUser
    .slice(queryStart + 1)
    .split(/([&;])/)
    .map((pair) => {
      const separator = pair.indexOf('=');
      if (separator === -1) return pair;
      const rawKey = pair.slice(0, separator);
      return isSensitiveKey(decodeQueryKey(rawKey)) ? `${rawKey}=${REDACTED}` : pair;
    })
    .join('');
  return `${withoutUser.slice(0, queryStart)}?${query}`.slice(0, maxLength);
}

function decodeQueryKey(key: string): string {
  try {
    return decodeURIComponent(key.replace(/\+/g, ' '));
  } catch {
    return key;
  }
}
