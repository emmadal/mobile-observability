import Link from 'next/link';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/auth/session';

/**
 * Overview: the first protected page. The proxy gates anonymous visitors and
 * the layout's UserMenu re-verifies the session; the greeting reads the
 * session again through the DAL, inside a Suspense boundary (request-time
 * read, cacheComponents).
 */
export default function OverviewPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16">
      <div className="flex w-full max-w-xl flex-col gap-5 rounded-2xl border border-zinc-200 bg-white p-10 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <Suspense
          fallback={
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Welcome
              </h1>
            </div>
          }
        >
          <Welcome />
        </Suspense>
        <div className="rounded-xl border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Set up a project</p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Create a project to get an ingest key for your app.
          </p>
          <Link
            href="/settings"
            className="mt-3 inline-block rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Open settings
          </Link>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          Install the SDK in your Expo app, upload source maps with{' '}
          <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono dark:bg-zinc-800">mobs</code>,
          and crashes, errors and performance metrics will show up here.
        </p>
      </div>
    </div>
  );
}

async function Welcome() {
  const user = await getCurrentUser();
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Welcome, {user.name}
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {user.email}
        {!user.emailVerified && ' (unverified)'}
      </p>
    </div>
  );
}
