import 'server-only';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from './server';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  /** Organization selected in the session, used to scope project reads. */
  activeOrganizationId: string | null;
}

/**
 * Data Access Layer boundary for the session: the only module pages should
 * use to read the session. Returns a narrow DTO — never the raw session or
 * user record — so sensitive fields cannot leak into client props.
 *
 * Session reads are request-time reads: callers sit behind a <Suspense>
 * boundary so the rest of the page streams first.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    activeOrganizationId: session.session.activeOrganizationId ?? null,
  };
}

/** Request-time gate for protected pages. Call inside a <Suspense> boundary. */
export async function getCurrentUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}
