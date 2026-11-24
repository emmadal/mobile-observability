import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { getInvitationForSignup } from '@/features/team/service';
import { isWorkspaceUnclaimed } from '@/lib/auth/access-policy';
import { getSessionUser } from '@/lib/auth/session';
import { InvitationForm, SetupForm } from '../auth-form';

export const metadata = { title: 'Join workspace' };

/**
 * Invite-only sign-up. With an invitation link the invitee creates their
 * account; on a fresh instance (no account yet) the first visitor sets the
 * workspace up and owns it; otherwise there is nothing to sign up for.
 */
export default function SignupPage({ searchParams }: PageProps<'/signup'>) {
  return (
    <Suspense fallback={<div className="h-80" />}>
      <SignupContent searchParams={searchParams} />
    </Suspense>
  );
}

function Heading({ title, description }: { title: string; description: string }) {
  return (
    <>
      <h1 className="font-wide text-xl font-semibold tracking-tight text-ink">{title}</h1>
      <p className="mt-1.5 mb-8 text-sm text-ink-2">{description}</p>
    </>
  );
}

const signInLink = (
  <Link href="/login" className="rounded font-medium text-ink underline underline-offset-4">
    Sign in
  </Link>
);

async function SignupContent({
  searchParams,
}: {
  searchParams: Promise<{ invitation?: string | string[] }>;
}) {
  // Request-time render before any database read (the pool reads the clock).
  await connection();
  // The proxy already redirects authenticated users away; this is the
  // server-verified backstop for direct visits and stale cookies.
  const [user, params] = await Promise.all([getSessionUser(), searchParams]);
  if (user) redirect('/');

  const invitationId =
    typeof params.invitation === 'string' ? params.invitation.slice(0, 128) : null;

  if (invitationId) {
    const invitation = await getInvitationForSignup(invitationId);
    if (!invitation) {
      return (
        <>
          <Heading
            title="This invite link no longer works"
            description="It expired, was revoked, or was already used. Ask the workspace owner for a new link."
          />
          <p className="text-xs text-ink-3">Already have an account? {signInLink}</p>
        </>
      );
    }
    return (
      <>
        <Heading
          title={`Join ${invitation.organizationName}`}
          description="Choose your name and a password to finish creating your account."
        />
        <InvitationForm invitationId={invitation.id} email={invitation.email} />
        <p className="mt-8 border-t border-line pt-5 text-xs text-ink-3">
          Already have an account? {signInLink}
        </p>
      </>
    );
  }

  if (await isWorkspaceUnclaimed()) {
    return (
      <>
        <Heading
          title="Set up this workspace"
          description="This instance has no account yet. The first account owns the workspace and invites everyone else."
        />
        <SetupForm />
      </>
    );
  }

  return (
    <>
      <Heading
        title="Accounts are created by invitation"
        description="Ask the workspace owner to send you an invite link, then open it to create your account."
      />
      <p className="text-xs text-ink-3">Already have an account? {signInLink}</p>
    </>
  );
}
