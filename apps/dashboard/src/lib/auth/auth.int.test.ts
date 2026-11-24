import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { member, organization, user } from '@/db/schema';
import { db, resetDatabase } from '../../../test/fixtures';
import { auth } from './server';

const credentials = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  password: 'correct horse battery',
};

/** Sign-up that returns a Response, so tests can chain its session cookies. */
const signUp = (body: Record<string, unknown>) =>
  auth.api.signUpEmail({
    body: { ...credentials, ...body },
    asResponse: true,
  }) as unknown as Promise<Response>;

/** Applies the Set-Cookie values of an auth response to a request Headers. */
const sessionHeaders = (response: Response) => {
  const pairs = response.headers.getSetCookie().map((setCookie) => setCookie.split(';')[0]);
  return new Headers({ cookie: pairs.join('; ') });
};

beforeEach(async () => {
  await resetDatabase();
});

describe('auth flow (T7)', () => {
  it('signs up, signs in and exposes the session', async () => {
    const response = await signUp({});
    expect(response.ok).toBe(true);
    const { token, user } = (await response.json()) as {
      token: string | null;
      user: { id: string; email: string };
    };
    expect(token).toBeTruthy();
    expect(user.email).toBe('ada@example.com');

    const session = await auth.api.getSession({ headers: sessionHeaders(response) });
    expect(session?.user.email).toBe('ada@example.com');

    const signInResponse = await auth.api.signInEmail({
      body: { email: credentials.email, password: credentials.password },
    });
    expect(signInResponse.user.id).toBe(user.id);
  });

  it('rejects a wrong password with a 4xx error', async () => {
    await signUp({});
    await expect(
      auth.api.signInEmail({ body: { email: credentials.email, password: 'wrong password!' } }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('enforces the 10-character password minimum', async () => {
    await expect(
      auth.api.signUpEmail({ body: { ...credentials, password: 'short' } }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('creates an organization owned by the fresh session', async () => {
    const response = await signUp({});
    const { user } = (await response.json()) as { user: { id: string } };

    const org = await auth.api.createOrganization({
      body: { name: 'Acme Inc', slug: 'acme-inc' },
      headers: sessionHeaders(response),
    });
    expect(org?.name).toBe('Acme Inc');
    if (!org) throw new Error('organization was not created');

    const [row] = await db.select().from(organization).where(eq(organization.id, org.id));
    expect(row?.slug).toBe('acme-inc');

    const members = await db.select().from(member).where(eq(member.organizationId, org.id));
    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe('owner');
    expect(members[0]?.userId).toBe(user.id);
  });

  it('rejects a duplicate organization slug', async () => {
    const owner = await signUp({});
    await auth.api.createOrganization({
      body: { name: 'Acme Inc', slug: 'acme-inc' },
      headers: sessionHeaders(owner),
    });
    await expect(
      auth.api.createOrganization({
        body: { name: 'Another Acme', slug: 'acme-inc' },
        headers: sessionHeaders(owner),
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('invite-only workspace', () => {
  /** The first account sets the workspace up and owns its organization. */
  async function setUpOwner() {
    const response = await signUp({ email: 'owner@example.com' });
    const headers = sessionHeaders(response);
    const org = await auth.api.createOrganization({
      body: { name: 'Acme Inc', slug: 'acme-inc' },
      headers,
    });
    if (!org) throw new Error('organization was not created');
    return { headers, organizationId: org.id };
  }

  const invite = (headers: Headers, organizationId: string, email: string) =>
    auth.api.createInvitation({
      body: { email, role: 'member', organizationId },
      headers,
    });

  it('refuses a second account without an invitation', async () => {
    await setUpOwner();
    await expect(signUp({ email: 'stranger@example.com' })).resolves.toMatchObject({
      status: 403,
    });
    const [row] = await db.select().from(user).where(eq(user.email, 'stranger@example.com'));
    expect(row).toBeUndefined();
  });

  it('lets an invitee create an account and join as a member', async () => {
    const owner = await setUpOwner();
    const invitation = await invite(owner.headers, owner.organizationId, 'bob@example.com');

    const response = await signUp({ name: 'Bob', email: 'bob@example.com' });
    expect(response.ok).toBe(true);
    await auth.api.acceptInvitation({
      body: { invitationId: invitation.id },
      headers: sessionHeaders(response),
    });

    const members = await db
      .select({ role: member.role, email: user.email })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, owner.organizationId));
    expect(members).toEqual(
      expect.arrayContaining([
        { role: 'owner', email: 'owner@example.com' },
        { role: 'member', email: 'bob@example.com' },
      ]),
    );
  });

  it('stops a revoked invitation from creating an account', async () => {
    const owner = await setUpOwner();
    const invitation = await invite(owner.headers, owner.organizationId, 'eve@example.com');
    await auth.api.cancelInvitation({
      body: { invitationId: invitation.id },
      headers: owner.headers,
    });
    await expect(signUp({ email: 'eve@example.com' })).resolves.toMatchObject({ status: 403 });
  });

  it('keeps inviting and organization creation with the owner', async () => {
    const owner = await setUpOwner();
    const invitation = await invite(owner.headers, owner.organizationId, 'bob@example.com');
    const response = await signUp({ name: 'Bob', email: 'bob@example.com' });
    const bob = sessionHeaders(response);
    await auth.api.acceptInvitation({ body: { invitationId: invitation.id }, headers: bob });

    await expect(invite(bob, owner.organizationId, 'carol@example.com')).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      auth.api.createOrganization({ body: { name: 'Side project', slug: 'side' }, headers: bob }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('closes the public sign-up and organization HTTP routes', async () => {
    const post = (path: string, body: unknown) =>
      auth.handler(
        new Request(`http://localhost:3000/api/auth${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
          body: JSON.stringify(body),
        }),
      );
    expect((await post('/sign-up/email', credentials)).status).toBe(404);
    expect((await post('/organization/create', { name: 'X', slug: 'x' })).status).toBe(404);
  });
});
