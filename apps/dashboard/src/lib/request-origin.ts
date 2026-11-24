import 'server-only';

import { headers } from 'next/headers';

/**
 * Origin the visitor is using (production domain or a preview URL), for links
 * shown back to them such as invite links. Request-time read.
 */
export async function getRequestOrigin(): Promise<string> {
  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  if (!host) return process.env.BETTER_AUTH_URL ?? '';
  const proto =
    requestHeaders.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export function invitationPath(invitationId: string): string {
  return `/signup?invitation=${encodeURIComponent(invitationId)}`;
}
