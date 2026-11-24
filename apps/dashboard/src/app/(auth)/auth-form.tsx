'use client';

import { type InputHTMLAttributes, useActionState } from 'react';
import { type AuthFormState, acceptInvitation, setUpWorkspace, signIn } from '@/app/actions/auth';
import { FieldError, FormError, inputClass, labelClass, primaryButtonClass } from '@/components/ui';

const initialState: AuthFormState = {};

type FieldName = 'name' | 'email' | 'password' | 'organization';

function Field({
  name,
  label,
  state,
  ...input
}: {
  name: FieldName;
  label: string;
  state: AuthFormState;
} & InputHTMLAttributes<HTMLInputElement>) {
  const error = state.fieldErrors?.[name];
  return (
    <label className={labelClass}>
      {label}
      <input
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
        className={inputClass}
        {...input}
      />
      <FieldError id={`${name}-error`} message={error} />
    </label>
  );
}

/**
 * Client forms only render fields and error strings. Passwords travel through
 * the Server Action POST — never stored in client state, and no auth internals
 * are bundled here.
 */
export function SignInForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signIn, initialState);
  return (
    <form action={action} className="flex flex-col gap-5">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Field name="email" label="Email" type="email" autoComplete="email" required state={state} />
      <Field
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        state={state}
      />
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className={`${primaryButtonClass} h-10 w-full`}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

export function SetupForm() {
  const [state, action, pending] = useActionState(setUpWorkspace, initialState);
  return (
    <form action={action} className="flex flex-col gap-5">
      <Field name="name" label="Your name" autoComplete="name" required state={state} />
      <Field
        name="organization"
        label="Workspace name"
        autoComplete="organization"
        placeholder="Acme mobile"
        required
        state={state}
      />
      <Field name="email" label="Email" type="email" autoComplete="email" required state={state} />
      <Field
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
        state={state}
      />
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className={`${primaryButtonClass} h-10 w-full`}>
        {pending ? 'Setting up…' : 'Create workspace'}
      </button>
    </form>
  );
}

export function InvitationForm({ invitationId, email }: { invitationId: string; email: string }) {
  const [state, action, pending] = useActionState(acceptInvitation, initialState);
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="invitation" value={invitationId} />
      <label className={labelClass}>
        Email
        <input value={email} readOnly disabled className={inputClass} />
      </label>
      <Field name="name" label="Your name" autoComplete="name" required state={state} />
      <Field
        name="password"
        label="Choose a password"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
        state={state}
      />
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className={`${primaryButtonClass} h-10 w-full`}>
        {pending ? 'Joining…' : 'Join workspace'}
      </button>
    </form>
  );
}
