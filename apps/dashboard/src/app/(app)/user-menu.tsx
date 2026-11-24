import Link from 'next/link';
import { signOut } from '@/app/actions/auth';
import { SignOutIcon } from '@/components/icons';
import { getOrgContext } from '@/features/projects/access';
import { getCurrentUser } from '@/lib/auth/session';

/**
 * Server component: the session is read here, inside the layout's Suspense
 * boundary, and only a narrow DTO reaches this point. Sign-out is a Server
 * Action invoked through a plain form — no client-side fetch involved.
 */
export async function UserMenu() {
  const [user, context] = await Promise.all([getCurrentUser(), getOrgContext()]);
  const role = context?.role === 'owner' ? 'Owner' : 'Member';

  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-raised text-xs font-semibold text-ink ring-1 ring-line-strong"
      >
        {user.name.slice(0, 1).toUpperCase()}
      </span>
      <Link href="/account" className="min-w-0 flex-1 rounded-md hover:text-ink">
        <p className="truncate text-xs font-medium text-ink">{user.name}</p>
        <p className="truncate text-2xs text-ink-3" title={user.email}>
          {role}, {user.email}
        </p>
      </Link>
      <form action={signOut}>
        <button
          type="submit"
          className="flex size-8 items-center justify-center rounded-md text-ink-3 hover:bg-raised hover:text-ink"
          title="Sign out"
        >
          <SignOutIcon />
          <span className="sr-only">Sign out</span>
        </button>
      </form>
    </div>
  );
}

/** Workspace name for the sidebar header. */
export async function WorkspaceName() {
  const context = await getOrgContext();
  return (
    <span className="block truncate text-2xs text-ink-3">
      {context?.organizationName ?? 'No workspace'}
    </span>
  );
}
