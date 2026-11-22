import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getSessionUser } from '@/lib/auth/session';
import { AuthForm } from '../auth-form';

export const metadata = { title: 'Sign up' };

export default function SignupPage() {
  return (
    <>
      <h1 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        Create your account
      </h1>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <SignupContent />
      </Suspense>
    </>
  );
}

async function SignupContent() {
  // The proxy already redirects authenticated users away; this is the
  // server-verified backstop for direct visits and stale cookies.
  const user = await getSessionUser();
  if (user) redirect('/');
  return <AuthForm mode="signup" />;
}
