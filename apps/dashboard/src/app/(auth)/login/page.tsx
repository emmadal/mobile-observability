import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getSessionUser } from '@/lib/auth/session';
import { AuthForm } from '../auth-form';

export const metadata = { title: 'Sign in' };

/**
 * searchParams and the session are request-time reads; both happen inside the
 * Suspense boundary so the rest of the page can prerender (cacheComponents).
 */
export default function LoginPage({ searchParams }: PageProps<'/login'>) {
  return (
    <>
      <h1 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Sign in</h1>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function LoginContent({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [user, params] = await Promise.all([getSessionUser(), searchParams]);
  // The proxy already redirects authenticated users away; this is the
  // server-verified backstop for direct visits and stale cookies.
  if (user) redirect('/');
  return <AuthForm mode="login" next={params.next} />;
}
