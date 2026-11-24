# @mobile-observability/dashboard

Self-hosted dashboard for [mobile-observability](../../README.md): issues, sessions and performance for your React Native/Expo apps.

## Stack

- **Next.js 16** App Router, rendered per request so every script carries the CSP nonce; React 19, Tailwind 4.
- **Better Auth** (email/password + organizations) on **Drizzle ORM** / **Postgres 18**.
- **Vitest** (unit + integration tests against a real Postgres), **Playwright** for E2E.

## Architecture rules

- Mutations go through **Server Actions** (`src/app/actions/**`); pages fetch data in React Server Components through server-only modules (`src/server/**`, `src/lib/**`). There is no client-side data fetching layer.
- `src/proxy.ts` performs the optimistic session gate and sets a per-request nonce CSP; pages re-verify the session via `src/lib/auth/session.ts` (`getCurrentUser`), always inside a `<Suspense>` boundary because session reads are request-time reads.
- API routes are limited to what external clients need: `/api/v1/*` (SDK ingest, authenticated by project keys) and `/api/auth/*` (Better Auth).

## Accounts and access

The workspace is invite-only, enforced inside Better Auth (`src/lib/auth/access-policy.ts`):

- The **first account** sets the workspace up and owns it: open `/signup` on an empty instance, or create it from the command line (credentials come from the environment and are never printed):

  ```sh
  ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='at least 10 characters' \
    DATABASE_URL=… BETTER_AUTH_SECRET=… pnpm admin:create
  ```

- Every other account comes from an **invite link** the owner creates in Settings → People. The link works once, for that email only, for 7 days; the owner can revoke it or remove members.
- Only the owner creates projects, rotates keys and invites people. The public `/api/auth/sign-up/email` and `/api/auth/organization/create` routes are closed.

## Environment

Copy `.env.example` to `.env`:

| Variable             | Purpose                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| `DATABASE_URL`       | Postgres connection string (`docker compose up -d db` at the repo root) |
| `TEST_DATABASE_URL`  | Database used by integration tests (created automatically)              |
| `BETTER_AUTH_SECRET` | Session signing secret — `openssl rand -base64 32`                      |
| `BETTER_AUTH_URL`    | Public base URL of the dashboard                                        |

## Scripts

```sh
pnpm dev          # next dev (Turbopack)
pnpm build        # production build
pnpm db:generate  # drizzle-kit generate
pnpm db:migrate   # apply migrations
pnpm admin:create # create the workspace owner (ADMIN_EMAIL, ADMIN_PASSWORD)
pnpm test         # vitest run (integration tests need Docker Postgres up)
```

Next.js 16 differs from earlier releases; its documentation ships in `node_modules/next/dist/docs/`.
