const VERIFY_FULL_ALIASES = new Set(['prefer', 'require', 'verify-ca']);

/**
 * pg currently treats `sslmode=prefer|require|verify-ca` as `verify-full`
 * (certificate and hostname checks) and warns at startup that pg v9 will
 * switch them to weaker libpq semantics. Hosted providers such as Neon hand
 * out `sslmode=require` URLs, so this pins today's verified behavior
 * explicitly: same connection now, still verified after the pg upgrade, and
 * no warning in the logs. URLs that opt into libpq semantics
 * (`uselibpqcompat=true`), disable TLS, or are not URLs are left untouched.
 */
export function withExplicitSslMode(connectionString: string): string {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return connectionString;
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return connectionString;
  if (url.searchParams.has('uselibpqcompat')) return connectionString;
  const mode = url.searchParams.get('sslmode');
  if (!mode || !VERIFY_FULL_ALIASES.has(mode)) return connectionString;
  url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}
