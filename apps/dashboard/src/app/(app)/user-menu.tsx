import { signOut } from '@/app/actions/auth';
import { getCurrentUser } from '@/lib/auth/session';

/**
 * Server component: the session is read here, inside the layout's Suspense
 * boundary, and only a narrow DTO reaches this point. Sign-out is a Server
 * Action invoked through a plain form — no client-side fetch involved.
 */
export async function UserMenu() {
  const user = await getCurrentUser();
  return (
    <div className="flex items-center gap-3">
      <span
        className="flex size-8 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white dark:bg-white dark:text-zinc-900"
        title={user.email}
      >
        {user.name.slice(0, 1).toUpperCase()}
      </span>
      <form action={signOut}>
        <button
          type="submit"
          className="rounded-full border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
