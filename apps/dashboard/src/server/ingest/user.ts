import type { Envelope } from '@mobile-observability/protocol';

/** "kyc:231770000001" → "kyc": a short leading word followed by a colon. */
const SEGMENT_PREFIX = /^([A-Za-z][A-Za-z0-9_-]{0,31}):./;

export interface UserColumns {
  userPhone: string | null;
  userSegment: string | null;
}

/**
 * Session-level user details: the phone number the app attached, and the
 * segment it named, else the `segment:` prefix of the id, so apps that encode
 * the group in the id (0.2 SDKs) are grouped without changes.
 */
export function userColumns(user: Envelope['user']): UserColumns {
  if (!user) return { userPhone: null, userSegment: null };
  const phone = user.phone?.trim() || null;
  const segment = user.segment?.trim() || SEGMENT_PREFIX.exec(user.id)?.[1]?.toLowerCase() || null;
  return { userPhone: phone, userSegment: segment };
}
