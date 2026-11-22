import 'server-only';

import { asc, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { member } from '@/db/schema';
import { getCurrentUser } from '@/lib/auth/session';

export interface OrgContext {
  userId: string;
  organizationId: string;
  role: string;
}

/**
 * Resolves the organization the visitor is working in. The session's active
 * organization wins when the visitor is still a member; otherwise the oldest
 * membership is used. One query, scoped by user id.
 */
export async function getOrgContext(): Promise<OrgContext | null> {
  const user = await getCurrentUser();
  const active = user.activeOrganizationId;
  const [membership] = await getDb()
    .select({ organizationId: member.organizationId, role: member.role })
    .from(member)
    .where(eq(member.userId, user.id))
    .orderBy(
      active ? desc(sql`${member.organizationId} = ${active}`) : asc(member.createdAt),
      asc(member.createdAt),
    )
    .limit(1);

  if (!membership) return null;
  return { userId: user.id, ...membership };
}
