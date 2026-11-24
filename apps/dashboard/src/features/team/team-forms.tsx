'use client';

import { useActionState } from 'react';
import {
  type InviteState,
  inviteMemberAction,
  removeMemberAction,
  revokeInvitationAction,
  type TeamActionState,
} from '@/app/actions/team';
import {
  dangerButtonClass,
  FieldError,
  FormError,
  inputClass,
  labelClass,
  primaryButtonClass,
} from '@/components/ui';
import { CopyField } from '@/features/projects/copy-field';

const initialInvite: InviteState = {};
const initialAction: TeamActionState = {};

/** Owner-only: invite by email; the link is shown to send by any channel. */
export function InviteForm() {
  const [state, action, pending] = useActionState(inviteMemberAction, initialInvite);

  return (
    <div className="border-b border-line px-5 py-4">
      <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className={`${labelClass} flex-1`}>
          Invite by email
          <input
            name="email"
            type="email"
            required
            autoComplete="off"
            placeholder="teammate@company.com"
            aria-describedby={state.fieldErrors?.email ? 'invite-email-error' : undefined}
            className={inputClass}
          />
        </label>
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? 'Creating invite…' : 'Create invite link'}
        </button>
      </form>
      <FieldError id="invite-email-error" message={state.fieldErrors?.email} />
      {state.error && (
        <div className="mt-3">
          <FormError message={state.error} />
        </div>
      )}
      {state.invited && (
        <div className="mt-4 rounded-md border border-good/40 bg-good/5 p-4">
          <CopyField
            label={`Invite link for ${state.invited.email}`}
            value={state.invited.link}
            note="Send this link yourself. It works once, for this email only, for 7 days."
          />
        </div>
      )}
    </div>
  );
}

export function RevokeInvitationButton({
  invitationId,
  email,
}: {
  invitationId: string;
  email: string;
}) {
  const [state, action, pending] = useActionState(revokeInvitationAction, initialAction);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="invitationId" value={invitationId} />
      <button
        type="submit"
        disabled={pending}
        className={dangerButtonClass}
        aria-label={`Revoke invite for ${email}`}
      >
        {pending ? 'Revoking…' : 'Revoke'}
      </button>
      {state.error && (
        <p role="alert" className="text-2xs text-critical">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function RemoveMemberButton({ memberId, name }: { memberId: string; name: string }) {
  const [state, action, pending] = useActionState(removeMemberAction, initialAction);
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(`Remove ${name} from this workspace? They lose access immediately.`)) {
          event.preventDefault();
        }
      }}
      className="flex flex-col items-end gap-1"
    >
      <input type="hidden" name="memberId" value={memberId} />
      <button
        type="submit"
        disabled={pending}
        className={dangerButtonClass}
        aria-label={`Remove ${name}`}
      >
        {pending ? 'Removing…' : 'Remove'}
      </button>
      {state.error && (
        <p role="alert" className="text-2xs text-critical">
          {state.error}
        </p>
      )}
    </form>
  );
}
