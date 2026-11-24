/** RFC 4122 v4 UUID. Uses Math.random because `crypto` is not available on every RN runtime. */
export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/**
 * A fresh W3C Trace Context trace id (32 hex characters). Random per request:
 * the backend joins on it to follow one operation from the phone to its
 * services. Randomness comes from Math.random, like uuid(), because `crypto`
 * is not available on every React Native runtime.
 */
export function traceId(): string {
  let id = '';
  for (let index = 0; index < 32; index += 1) {
    id += Math.floor(Math.random() * 16).toString(16);
  }
  return id;
}

/** `00-<trace-id>-<span-id>-01`, the header value the SDK injects upstream. */
export function traceparent(id: string): string {
  let span = '';
  for (let index = 0; index < 16; index += 1) {
    span += Math.floor(Math.random() * 16).toString(16);
  }
  return `00-${id}-${span}-01`;
}

/** Stable value in [0, 1) derived from a string (FNV-1a), used for per-installation sampling. */
export function hashToUnitInterval(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x100000000;
}

export function isSampledIn(installationId: string, sampleRate: number): boolean {
  if (sampleRate >= 1) return true;
  if (sampleRate <= 0) return false;
  return hashToUnitInterval(installationId) < sampleRate;
}
