import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { organization } from 'better-auth/plugins';
import * as authSchema from '@/db/auth-schema';
import { getDb } from '@/db/client';

import { canCreateAccount, canCreateOrganization, INVITE_ONLY_MESSAGE } from './access-policy';
import { sendEmail } from './mailer';

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || secret.length < 16) {
  throw new Error(
    'BETTER_AUTH_SECRET must be set to at least 16 characters (openssl rand -base64 32)',
  );
}

export const auth = betterAuth({
  database: drizzleAdapter(getDb(), { provider: 'pg', schema: authSchema }),
  disabledPaths: [
    // Listing invitations by email would let someone who registers an invitee's
    // (unverified) address discover and accept the invite. Accepting therefore
    // requires the secret invitation link, and the session email must match.
    '/organization/list-user-invitations',
    // Accounts and organizations are only created through the dashboard's
    // server actions (first-run setup, invitation links), which call auth.api
    // directly; these paths only close the public HTTP routes.
    '/sign-up/email',
    '/organization/create',
  ],
  databaseHooks: {
    user: {
      create: {
        // Invite-only workspace: the first account, then invitees only.
        before: async (newUser) => {
          if (!(await canCreateAccount(newUser.email))) {
            throw new APIError('FORBIDDEN', { message: INVITE_ONLY_MESSAGE });
          }
          return { data: newUser };
        },
      },
    },
  },
  emailVerification: {
    sendOnSignUp: false,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: 'Verify your email',
        text: `Verify your email: ${url}`,
      });
    },
  },
  emailAndPassword: { enabled: true, minPasswordLength: 10, autoSignIn: true },
  session: { cookieCache: { enabled: true, maxAge: 60 } },
  plugins: [
    organization({
      // Only the workspace owner creates organizations; invitees join.
      allowUserToCreateOrganization: (user) => canCreateOrganization(user.id),
      // Invitations are shared as links from Settings; no email provider is required.
      sendInvitationEmail: async () => undefined,
      // With a mail provider configured, invitees must also prove email ownership.
      requireEmailVerificationOnInvitation: process.env.MAIL_PROVIDER_CONFIGURED === 'true',
      invitationExpiresIn: 7 * 24 * 60 * 60,
    }),
    nextCookies(),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
