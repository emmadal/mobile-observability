import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { member, organization } from '@/db/schema';
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
    const first = await signUp({ email: 'first@example.com' });
    await auth.api.createOrganization({
      body: { name: 'Acme Inc', slug: 'acme-inc' },
      headers: sessionHeaders(first),
    });

    const second = await signUp({ email: 'second@example.com' });
    await expect(
      auth.api.createOrganization({
        body: { name: 'Another Acme', slug: 'acme-inc' },
        headers: sessionHeaders(second),
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
