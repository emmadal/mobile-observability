import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { organization } from 'better-auth/plugins';
import * as authSchema from '@/db/auth-schema';
import { getDb } from '@/db/client';

import { sendEmail } from './mailer';

export const auth = betterAuth({
  database: drizzleAdapter(getDb(), { provider: 'pg', schema: authSchema }),
  // Listing invitations by email would let someone who registers an invitee's
  // (unverified) address discover and accept the invite. Accepting therefore
  // requires the secret invitation link, and the session email must match.
  disabledPaths: ['/organization/list-user-invitations'],
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
