/**
 * Sensitive values never leave the device. Keys that look like credentials,
 * payment data or personal identifiers have their value replaced before the
 * item is queued (rule from the security checklist: passwords, OTPs, tokens,
 * card numbers and personal identifiers are never sent).
 */
const SENSITIVE_KEY_PATTERN =
  /pass(word)?|pwd|secret|token|otp|one[-_]?time|authorization|bearer|api[-_]?key|credential|card|cvv|cvc|ssn|social[-_]?security/i;

const REDACTED = '[redacted]';

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/** Returns a copy where every sensitive top-level key is redacted. */
export function redactSensitive(values: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    result[key] = isSensitiveKey(key) ? REDACTED : value;
  }
  return result;
}
