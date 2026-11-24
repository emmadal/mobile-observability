'use server';

import { APIError } from 'better-auth/api';
import { headers } from 'next/headers';
import { z } from 'zod';
import { auth } from '@/lib/auth/server';
import { getCurrentUser } from '@/lib/auth/session';

export interface ChangePasswordState {
  error?: string;
  fieldErrors?: Partial<Record<'currentPassword' | 'newPassword' | 'confirmPassword', string>>;
  changed?: boolean;
}

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    // Mirrors betterAuth.minPasswordLength; Better Auth enforces the real rule.
    newPassword: z
      .string()
      .min(10, 'Use at least 10 characters.')
      .max(128, 'Use at most 128 characters.'),
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The two new passwords do not match.',
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    path: ['newPassword'],
    message: 'Choose a password different from the current one.',
  });

/**
 * Changes the signed-in user's password and signs out every other device.
 * Better Auth verifies the current password and issues a fresh session
 * cookie for this browser (nextCookies plugin).
 */
export async function changePasswordAction(
  _state: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  await getCurrentUser();

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.success) {
    const fieldErrors: ChangePasswordState['fieldErrors'] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof NonNullable<ChangePasswordState['fieldErrors']>;
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors };
  }

  try {
    await auth.api.changePassword({
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        revokeOtherSessions: true,
      },
      headers: await headers(),
    });
  } catch (error) {
    if (error instanceof APIError) {
      const status = Number(error.statusCode ?? 500);
      if (status === 400 || status === 401) {
        return { fieldErrors: { currentPassword: 'The current password is incorrect.' } };
      }
      return { error: 'The password could not be changed. Please try again.' };
    }
    throw error;
  }
  return { changed: true };
}
