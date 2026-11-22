'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { type AuthFormState, signIn, signUp } from '@/app/actions/auth';

const initialState: AuthFormState = {};

const inputClass =
  'mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-100';

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-600 dark:text-red-400">{message}</p>;
}

interface AuthFormProps {
  mode: 'login' | 'signup';
  /** Sanitized same-origin redirect target, resolved server-side. */
  next?: string;
}

/**
 * The client component only renders form fields and error strings. The
 * password travels through the Server Action POST — it is never stored in
 * client state, and no auth internals are bundled with this component.
 */
export function AuthForm({ mode, next }: AuthFormProps) {
  const isSignup = mode === 'signup';
  const [state, action, pending] = useActionState(isSignup ? signUp : signIn, initialState);

  return (
    <form action={action} className="flex flex-col gap-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {isSignup && (
        <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Your name
          <input id="name" name="name" autoComplete="name" className={inputClass} />
          <FieldError message={state.fieldErrors?.name} />
        </label>
      )}

      {isSignup && (
        <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Organization
          <input
            id="organization"
            name="organization"
            autoComplete="organization"
            className={inputClass}
          />
          <FieldError message={state.fieldErrors?.organization} />
        </label>
      )}

      <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
        Email
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className={inputClass}
        />
        <FieldError message={state.fieldErrors?.email} />
      </label>

      <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
        Password
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={isSignup ? 'new-password' : 'current-password'}
          required
          className={inputClass}
        />
        <FieldError message={state.fieldErrors?.password} />
      </label>

      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {isSignup ? 'Create account' : 'Sign in'}
      </button>

      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        {isSignup ? (
          <>
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-zinc-900 underline dark:text-white">
              Sign in
            </Link>
          </>
        ) : (
          <>
            No account yet?{' '}
            <Link href="/signup" className="font-medium text-zinc-900 underline dark:text-white">
              Sign up
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
