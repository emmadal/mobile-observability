const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_HEX = /^[0-9a-f]{16,}$/i;
const NUMERIC = /^\d+$/;
const ABSOLUTE = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/i;

/** Replaces id-like path segments with `:id` so endpoints group together (AC-5). */
export function templatePath(path: string): string {
  if (!path) return '/';
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return normalized
    .split('/')
    .map((segment) =>
      NUMERIC.test(segment) || UUID.test(segment) || LONG_HEX.test(segment) ? ':id' : segment,
    )
    .join('/');
}

export interface SanitizedUrl {
  host: string;
  path: string;
}

/**
 * Splits a URL into host and templated path, dropping user info, query and fragment.
 * Implemented with a regex because the URL class is incomplete on some RN runtimes.
 */
export function sanitizeUrl(url: string): SanitizedUrl {
  const match = ABSOLUTE.exec(url);
  if (match) {
    const authority = match[2] ?? '';
    const host = authority.slice(authority.lastIndexOf('@') + 1).toLowerCase();
    return { host, path: templatePath(match[3] ?? '') };
  }
  const path = url.split(/[?#]/, 1)[0] ?? '';
  return { host: '', path: templatePath(path) };
}
