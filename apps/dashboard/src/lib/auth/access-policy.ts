import { and, count, eq, gt, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { invitation, member, organization, user, workspaceClaim } from '@/db/schema';

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

/**
 * Atomically claims the workspace for this email. The singleton row makes
 * concurrent first-run setups race on one INSERT: exactly one email wins, and
 * only that email can claim again (a retry after a failed sign-up).
 */
async function claimWorkspace(email: string): Promise<boolean> {
  const db = getDb();
  const normalized = email.toLowerCase();
  const [inserted] = await db
    .insert(workspaceClaim)
    .values({ id: 1, email: normalized })
    .onConflictDoNothing()
    .returning({ email: workspaceClaim.email });
  if (inserted) return true;
  const [claim] = await db.select({ email: workspaceClaim.email }).from(workspaceClaim).limit(1);
  return claim?.email === normalized;
}

/** Accounts are created by the first-run claimant or from an invitation. */
export async function canCreateAccount(email: string): Promise<boolean> {
  if (await hasPendingInvitation(email)) return true;
  return (await isWorkspaceUnclaimed()) && (await claimWorkspace(email));
}

/**
 * Organizations are created by the workspace owner only: the first-run
 * claimant (while no organization exists) or an existing organization owner.
 */
export async function canCreateOrganization(userId: string): Promise<boolean> {
  const db = getDb();
  const [existing] = await db.select({ id: organization.id }).from(organization).limit(1);
  if (!existing) {
    const [claimant] = await db
      .select({ id: user.id })
      .from(user)
      .innerJoin(workspaceClaim, eq(workspaceClaim.email, sql`lower(${user.email})`))
      .where(eq(user.id, userId))
      .limit(1);
    return Boolean(claimant);
  }
  const [ownership] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.role, 'owner')))
    .limit(1);
  return Boolean(ownership);
}

export const INVITE_ONLY_MESSAGE =
  'Accounts are created by invitation. Ask the workspace owner for an invite link.';
