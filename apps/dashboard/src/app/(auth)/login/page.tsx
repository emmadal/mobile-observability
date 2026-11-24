import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { isWorkspaceUnclaimed } from '@/lib/auth/access-policy';
import { getSessionUser } from '@/lib/auth/session';
import { SignInForm } from '../auth-form';

export const metadata = { title: 'Sign in' };

/** searchParams and the session are request-time reads, streamed in Suspense. */
export default function LoginPage({ searchParams }: PageProps<'/login'>) {
  return (
    <>
      <h1 className="font-wide text-xl font-semibold tracking-tight text-ink">Sign in</h1>
      <p className="mt-1.5 mb-8 text-sm text-ink-2">
        Use the account your workspace owner gave you.
      </p>
      <Suspense fallback={<div className="h-56" />}>
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function LoginContent({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  // Request-time render before any database read (the pool reads the clock).
  await connection();
  const [user, params, unclaimed] = await Promise.all([
    getSessionUser(),
    searchParams,
    isWorkspaceUnclaimed(),
  ]);
  // The proxy already redirects authenticated users away; this is the
  // server-verified backstop for direct visits and stale cookies.
  if (user) redirect('/');
  return (
    <>
      <SignInForm next={params.next} />
      <p className="mt-8 border-t border-line pt-5 text-xs text-ink-3">
        {unclaimed ? (
          <>
            New instance with no account yet?{' '}
            <Link
              href="/signup"
              className="rounded font-medium text-ink underline underline-offset-4"
            >
              Set up this workspace
            </Link>
          </>
        ) : (
          'No account? Accounts are created by invitation. Ask the workspace owner for an invite link.'
        )}
      </p>
    </>
  );
}
