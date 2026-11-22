/**
 * Local development bootstrap: creates (once) a demo owner, organization and
 * project, and prints a fresh ingest key and upload token.
 *
 *   pnpm --filter @mobile-observability/dashboard dev:project
 *
 * Never run against production: the demo password is public.
 */
import { and, eq } from 'drizzle-orm';
import { getDb } from '../src/db/client';
import { apiKeys, member, organization, projects, user } from '../src/db/schema';
import { auth } from '../src/lib/auth/server';
import { generateKey } from '../src/server/keys/keys';

const EMAIL = process.env.DEMO_EMAIL ?? 'demo@mobile-observability.dev';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'observability-demo';

async function main() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('dev-project must not run in production');
  const db = getDb();

  let [owner] = await db.select().from(user).where(eq(user.email, EMAIL));
  if (!owner) {
    await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: 'Demo Owner' } });
    [owner] = await db.select().from(user).where(eq(user.email, EMAIL));
  }
  if (!owner) throw new Error('could not create demo user');

  let [membership] = await db.select().from(member).where(eq(member.userId, owner.id));
  if (!membership) {
    const orgId = crypto.randomUUID();
    await db
      .insert(organization)
      .values({ id: orgId, name: 'Demo', slug: 'demo', createdAt: new Date() });
    await db.insert(member).values({
      id: crypto.randomUUID(),
      organizationId: orgId,
      userId: owner.id,
      role: 'owner',
      createdAt: new Date(),
    });
    [membership] = await db.select().from(member).where(eq(member.userId, owner.id));
  }
  if (!membership) throw new Error('could not create demo organization');

  let [project] = await db
    .select()
    .from(projects)
    .where(
      and(eq(projects.organizationId, membership.organizationId), eq(projects.slug, 'example')),
    );
  if (!project) {
    [project] = await db
      .insert(projects)
      .values({ organizationId: membership.organizationId, name: 'Example app', slug: 'example' })
      .returning();
  }
  if (!project) throw new Error('could not create demo project');

  const ingest = generateKey('ingest');
  const upload = generateKey('upload');
  await db.insert(apiKeys).values([
    {
      projectId: project.id,
      kind: 'ingest',
      keyHash: ingest.hash,
      keyPrefix: ingest.prefix,
      publicKey: ingest.key,
      createdBy: owner.id,
    },
    {
      projectId: project.id,
      kind: 'upload',
      keyHash: upload.hash,
      keyPrefix: upload.prefix,
      createdBy: owner.id,
    },
  ]);

  console.log(
    JSON.stringify(
      {
        email: EMAIL,
        password: PASSWORD,
        projectId: project.id,
        ingestKey: ingest.key,
        uploadToken: upload.key,
      },
      null,
      2,
    ),
  );
  await db.$client.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
