import { and, count, eq, gt, sql } from 'drizzle-orm';
import { invitation, member, organization, user } from '@/db/auth-schema';
import { getDb } from '@/db/client';

/**
 * Workspace access policy. The first account sets the workspace up and owns
 * it; every other account exists because that owner invited it.
 *
 * Enforced inside Better Auth (database hooks and organization options), so it
 * holds for every caller: server actions, scripts and the HTTP API alike.
 */

/** True while the instance has no account yet (first-run setup). */
export async function isWorkspaceUnclaimed(): Promise<boolean> {
  const [row] = await getDb().select({ total: count() }).from(user);
  return (row?.total ?? 0) === 0;
}

/** A pending, unexpired invitation for this email (case-insensitive). */
export async function hasPendingInvitation(email: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        eq(sql`lower(${invitation.email})`, email.toLowerCase()),
        eq(invitation.status, 'pending'),
        gt(invitation.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Accounts are created during first-run setup or from an invitation. */
export async function canCreateAccount(email: string): Promise<boolean> {
  return (await isWorkspaceUnclaimed()) || (await hasPendingInvitation(email));
}

/**
 * Organizations are created by the workspace owner only: the first account
 * (when no organization exists yet) or an existing organization owner.
 */
export async function canCreateOrganization(userId: string): Promise<boolean> {
  const db = getDb();
  const [existing] = await db.select({ id: organization.id }).from(organization).limit(1);
  if (!existing) return true;
  const [ownership] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.role, 'owner')))
    .limit(1);
  return Boolean(ownership);
}

export const INVITE_ONLY_MESSAGE =
  'Accounts are created by invitation. Ask the workspace owner for an invite link.';
