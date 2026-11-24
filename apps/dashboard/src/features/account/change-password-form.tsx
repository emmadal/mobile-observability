'use client';

import { useActionState } from 'react';
import { type ChangePasswordState, changePasswordAction } from '@/app/actions/account';
import { CheckIcon } from '@/components/icons';
import { FieldError, FormError, inputClass, labelClass, primaryButtonClass } from '@/components/ui';

const initialState: ChangePasswordState = {};

type Field = keyof NonNullable<ChangePasswordState['fieldErrors']>;

const fields: { name: Field; label: string; autoComplete: string; hint?: string }[] = [
  { name: 'currentPassword', label: 'Current password', autoComplete: 'current-password' },
  {
    name: 'newPassword',
    label: 'New password',
    autoComplete: 'new-password',
    hint: 'At least 10 characters.',
  },
  { name: 'confirmPassword', label: 'Confirm new password', autoComplete: 'new-password' },
];

/** Passwords travel only through the Server Action POST; nothing is kept in state. */
export function ChangePasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(changePasswordAction, initialState);

  return (
    <form action={action} className="flex max-w-md flex-col gap-5 px-5 pt-4 pb-5">
      {/* Lets password managers pair the new password with this account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      {fields.map((field) => {
        const error = state.fieldErrors?.[field.name];
        const describedBy = error
          ? `${field.name}-error`
          : field.hint
            ? `${field.name}-hint`
            : undefined;
        return (
          <label key={field.name} className={labelClass}>
            {field.label}
            <input
              name={field.name}
              type="password"
              autoComplete={field.autoComplete}
              required
              minLength={field.name === 'currentPassword' ? undefined : 10}
              maxLength={128}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              className={inputClass}
            />
            {error ? (
              <FieldError id={`${field.name}-error`} message={error} />
            ) : (
              field.hint && (
                <p id={`${field.name}-hint`} className="mt-1.5 text-2xs text-ink-3">
                  {field.hint}
                </p>
              )
            )}
          </label>
        );
      })}

      <FormError message={state.error} />
      {state.changed && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-md border border-good/40 bg-good/10 px-3 py-2 text-xs text-ink"
        >
          <CheckIcon className="size-3.5 shrink-0 text-good" />
          Password changed. Every other device was signed out.
        </p>
      )}

      <div>
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? 'Changing password…' : 'Change password'}
        </button>
      </div>
    </form>
  );
}
