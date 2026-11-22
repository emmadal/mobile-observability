import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { organization } from 'better-auth/plugins';
import * as authSchema from '@/db/auth-schema';
import { getDb } from '@/db/client';

export const auth = betterAuth({
  database: drizzleAdapter(getDb(), { provider: 'pg', schema: authSchema }),
  emailAndPassword: { enabled: true, minPasswordLength: 10, autoSignIn: true },
  session: { cookieCache: { enabled: true, maxAge: 60 } },
  plugins: [
    organization({
      // Invitations are shared as links from Settings; no email provider is required.
      sendInvitationEmail: async () => undefined,
    }),
    nextCookies(),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
