import { Suspense } from 'react';
import { PageHeader, Panel } from '@/components/ui';
import { ChangePasswordForm } from '@/features/account/change-password-form';
import { getOrgContext } from '@/features/projects/access';
import { getCurrentUser } from '@/lib/auth/session';

export const metadata = { title: 'Account' };

export default function AccountPage() {
  return (
    <>
      <PageHeader title="Account" description="Your sign-in details and password." />
      <div className="flex flex-col gap-4 px-5 py-6 sm:px-8">
        <Suspense
          fallback={
            <div
              aria-hidden="true"
              className="h-[30rem] max-w-3xl rounded-[10px] border border-line bg-panel motion-safe:animate-pulse"
            />
          }
        >
          <Profile />
        </Suspense>
      </div>
    </>
  );
}

async function Profile() {
  const [user, context] = await Promise.all([getCurrentUser(), getOrgContext()]);
  const rows = [
    { label: 'Name', value: user.name },
    { label: 'Email', value: user.email },
    { label: 'Workspace', value: context?.organizationName ?? 'None' },
    { label: 'Role', value: context?.role === 'owner' ? 'Owner' : 'Member' },
  ];
  return (
    <>
      <Panel title="Profile" className="max-w-3xl">
        <dl className="mt-4 border-t border-line">
          {rows.map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-[8rem_minmax(0,1fr)] gap-4 border-b border-line px-5 py-3 last:border-b-0"
            >
              <dt className="text-xs text-ink-3">{row.label}</dt>
              <dd className="truncate text-sm text-ink">{row.value}</dd>
            </div>
          ))}
        </dl>
      </Panel>
      <Panel
        title="Password"
        description="Changing it signs you out everywhere except this browser."
        className="max-w-3xl"
      >
        <div className="mt-4 border-t border-line">
          <ChangePasswordForm email={user.email} />
        </div>
      </Panel>
    </>
  );
}
