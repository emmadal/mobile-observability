import 'server-only';

import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { invitation, member, organization, user } from '@/db/schema';

export interface TeamMember {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: Date;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: string;
  createdAt: Date;
  expiresAt: Date;
  expired: boolean;
}

export interface InvitationForSignup {
  id: string;
  email: string;
  organizationName: string;
}

/** Members of an organization, owners first, then by join date. */
export async function listMembers(organizationId: string): Promise<TeamMember[]> {
  const rows = await getDb()
    .select({
      memberId: member.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      role: member.role,
      joinedAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, organizationId))
    .orderBy(asc(member.createdAt));
  return rows.sort((a, b) => Number(b.role === 'owner') - Number(a.role === 'owner'));
}

/** Invitations still waiting to be accepted (expired ones included, flagged by date). */
export async function listPendingInvitations(organizationId: string): Promise<PendingInvitation[]> {
  const rows = await getDb()
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
      expired: sql<boolean>`${invitation.expiresAt} <= now()`,
    })
    .from(invitation)
    .where(and(eq(invitation.organizationId, organizationId), eq(invitation.status, 'pending')))
    .orderBy(desc(invitation.createdAt));
  return rows.map((row) => ({ ...row, role: row.role ?? 'member' }));
}

/** A usable invitation (pending, not expired) for the sign-up page. */
export async function getInvitationForSignup(id: string): Promise<InvitationForSignup | null> {
  const [row] = await getDb()
    .select({
      id: invitation.id,
      email: invitation.email,
      organizationName: organization.name,
    })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .where(
      and(
        eq(invitation.id, id),
        eq(invitation.status, 'pending'),
        gt(invitation.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  return row ?? null;
}
