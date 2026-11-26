import Link from 'next/link';
import { getOrgContext } from '@/features/projects/access';
import { getCurrentUser } from '@/lib/auth/session';
import { SignOutButton } from './sign-out-button';

/**
 * Server component: the session is read here, inside the layout's Suspense
 * boundary, and only a narrow DTO reaches this point. Sign-out asks for
 * confirmation, then runs a Server Action through a plain form.
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
      <SignOutButton />
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
