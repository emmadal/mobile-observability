'use server';

import { APIError } from 'better-auth/api';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { getOrgContext } from '@/features/projects/access';
import { auth } from '@/lib/auth/server';
import { getRequestOrigin, invitationPath } from '@/lib/request-origin';

export interface InviteState {
  error?: string;
  fieldErrors?: { email?: string };
  /** The invite link, shown to the owner so they can send it. */
  invited?: { email: string; link: string };
}

export interface TeamActionState {
  error?: string;
}

const inviteSchema = z.object({ email: z.email('Enter a valid email address.') });
const idSchema = z.object({ id: z.string().min(1).max(128) });

function apiMessage(error: APIError, fallback: string): string {
  return Number(error.statusCode ?? 500) < 500 && error.message ? error.message : fallback;
}

/** Owner-only: creates (or renews) an invitation and returns its link. */
export async function inviteMemberAction(
  _state: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const context = await getOrgContext();
  if (!context) return { error: 'No organization found for this account.' };
  if (context.role !== 'owner') return { error: 'Only the workspace owner can invite people.' };

  const parsed = inviteSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) return { fieldErrors: { email: parsed.error.issues[0]?.message } };

  try {
    const invitation = await auth.api.createInvitation({
      body: {
        email: parsed.data.email,
        role: 'member',
        organizationId: context.organizationId,
        resend: true,
      },
      headers: await headers(),
    });
    revalidatePath('/settings');
    return {
      invited: {
        email: invitation.email,
        link: `${await getRequestOrigin()}${invitationPath(invitation.id)}`,
      },
    };
  } catch (error) {
    if (error instanceof APIError) {
      return { error: apiMessage(error, 'The invitation could not be created.') };
    }
    throw error;
  }
}

/** Owner-only: revokes a pending invitation; its link stops working. */
export async function revokeInvitationAction(
  _state: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const context = await getOrgContext();
  if (!context) return { error: 'No organization found for this account.' };
  if (context.role !== 'owner') return { error: 'Only the workspace owner can revoke invites.' };

  const parsed = idSchema.safeParse({ id: formData.get('invitationId') });
  if (!parsed.success) return { error: 'Invalid request.' };

  try {
    await auth.api.cancelInvitation({
      body: { invitationId: parsed.data.id },
      headers: await headers(),
    });
  } catch (error) {
    if (error instanceof APIError) {
      return { error: apiMessage(error, 'The invite could not be revoked.') };
    }
    throw error;
  }
  revalidatePath('/settings');
  return {};
}

/** Owner-only: removes a member's access to the organization. */
export async function removeMemberAction(
  _state: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const context = await getOrgContext();
  if (!context) return { error: 'No organization found for this account.' };
  if (context.role !== 'owner') return { error: 'Only the workspace owner can remove people.' };

  const parsed = idSchema.safeParse({ id: formData.get('memberId') });
  if (!parsed.success) return { error: 'Invalid request.' };

  try {
    await auth.api.removeMember({
      body: { memberIdOrEmail: parsed.data.id, organizationId: context.organizationId },
      headers: await headers(),
    });
  } catch (error) {
    if (error instanceof APIError) {
      return { error: apiMessage(error, 'This person could not be removed.') };
    }
    throw error;
  }
  revalidatePath('/settings');
  return {};
}
