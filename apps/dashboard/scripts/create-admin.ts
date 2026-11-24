/**
 * Creates the workspace owner on a fresh instance: the account that alone can
 * invite people, create projects and rotate keys.
 *
 *   ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='…' \
 *     pnpm --filter @mobile-observability/dashboard admin:create
 *
 * Optional: ADMIN_NAME (default "Admin"), WORKSPACE_NAME (default
 * "Mobile Observability"). Credentials come from the environment only and are
 * never printed. Safe to re-run: an existing owner is left untouched.
 */
import { applySetCookies } from 'better-auth/cookies/utils';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../src/db/client';
import { member, organization, user } from '../src/db/schema';
import { isWorkspaceUnclaimed } from '../src/lib/auth/access-policy';
import { auth } from '../src/lib/auth/server';
import { slugify } from '../src/lib/slug';

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME?.trim() || 'Admin';
const workspace = process.env.WORKSPACE_NAME?.trim() || 'Mobile Observability';

async function ownsOrganization(userId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.role, 'owner')))
    .limit(1);
  return Boolean(row);
}

async function main(): Promise<void> {
  if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD.');
  if (password.length < 10) throw new Error('ADMIN_PASSWORD must be at least 10 characters.');
  const db = getDb();

  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (existing && (await ownsOrganization(existing.id))) {
    console.log(`Owner ${email} already exists; nothing to do.`);
    return;
  }
  if (!existing && !(await isWorkspaceUnclaimed())) {
    throw new Error('This workspace already has accounts; invite new people from Settings.');
  }

  let session: Headers;
  if (existing) {
    const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    if (!response.ok) throw new Error(`Sign-in failed for ${email} (status ${response.status}).`);
    session = new Headers();
    applySetCookies(session, response.headers.getSetCookie());
  } else {
    const response = await auth.api.signUpEmail({
      body: { name, email, password },
      asResponse: true,
    });
    if (!response.ok) throw new Error(`Sign-up failed for ${email} (status ${response.status}).`);
    session = new Headers();
    applySetCookies(session, response.headers.getSetCookie());
  }

  const [anyOrganization] = await db.select({ id: organization.id }).from(organization).limit(1);
  if (anyOrganization) {
    throw new Error('An organization already exists without this owner; resolve it manually.');
  }
  await auth.api.createOrganization({
    body: { name: workspace, slug: slugify(workspace) },
    headers: session,
  });
  console.log(`Owner ${email} created with workspace "${workspace}".`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => getDb().$client.end());
