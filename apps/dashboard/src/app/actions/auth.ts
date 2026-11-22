'use server';

import { APIError } from 'better-auth/api';
import { applySetCookies } from 'better-auth/cookies/utils';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth } from '@/lib/auth/server';
import { slugify } from '@/lib/slug';

const credentialsSchema = z.object({
  email: z.email('Enter a valid email address.'),
  // Mirrors betterAuth.minPasswordLength; the server enforces the real rule.
  password: z.string().min(10, 'Password must be at least 10 characters.'),
});

const signupSchema = credentialsSchema.extend({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(80),
  organization: z
    .string()
    .trim()
    .min(2, 'Organization name must be at least 2 characters.')
    .max(80),
});

export interface AuthFormState {
  error?: string;
  fieldErrors?: Partial<Record<'name' | 'email' | 'password' | 'organization', string>>;
}

/** Same-origin relative paths only; blocks protocol-relative //host and \ tricks. */
function safeNextPath(raw: FormDataEntryValue | null): string {
  if (typeof raw !== 'string') return '/';
  const path = raw.slice(0, 512);
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') ? path : '/';
}

function fieldErrors(error: z.ZodError): AuthFormState['fieldErrors'] {
  const flattened: AuthFormState['fieldErrors'] = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '');
    if (key in { name: 1, email: 1, password: 1, organization: 1 }) {
      const slot = key as keyof NonNullable<AuthFormState['fieldErrors']>;
      flattened[slot] ??= issue.message;
    }
  }
  return flattened;
}

/**
 * Maps Better Auth errors to form messages. 4xx responses carry user-facing
 * messages (duplicate email, taken slug); anything else is generic so we do
 * not leak server internals to the browser.
 */
function formError(error: APIError): string {
  const statusCode = Number(error.statusCode ?? 500);
  if (statusCode < 500 && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}

export async function signUp(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signupSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
    organization: formData.get('organization'),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const { name, email, password, organization } = parsed.data;
  try {
    // `asResponse` still runs the nextCookies hook (the session cookie lands
    // in this action's cookie store, signing the visitor in) while returning
    // the Set-Cookie headers needed to continue under the fresh session below.
    const response = await auth.api.signUpEmail({
      body: { name, email, password },
      asResponse: true,
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      return { error: body?.message ?? 'Sign-up failed. Please try again.' };
    }

    const requestHeaders = new Headers(await headers());
    applySetCookies(requestHeaders, response.headers.getSetCookie());
    await auth.api.createOrganization({
      body: { name: organization, slug: slugify(organization) },
      headers: requestHeaders,
    });
  } catch (error) {
    if (error instanceof APIError) return { error: formError(error) };
    throw error;
  }

  redirect(safeNextPath(formData.get('next')));
}

export async function signIn(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  try {
    await auth.api.signInEmail({ body: parsed.data });
  } catch (error) {
    if (error instanceof APIError) return { error: formError(error) };
    throw error;
  }

  redirect(safeNextPath(formData.get('next')));
}

export async function signOut(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect('/login');
}
