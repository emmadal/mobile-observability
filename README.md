# mobile-observability

Open-source observability for React Native and Expo apps: crash reporting (JS and native), error grouping with source-map symbolication, sessions and performance metrics — with a **self-hosted dashboard you own**.

No vendor, no per-seat pricing, no data leaving your infrastructure. Install the SDK, point it at your server, and read your crashes in your browser.

- **SDK** (`@mobile-observability/react-native`) — an Expo-native module with a drop-in `Observe` API that mirrors `expo-observe`, an offline-first queue and a batched, gzipped transport.
- **Dashboard** (`apps/dashboard`) — a Next.js 16 (App Router) web app backed by your own Postgres, with email/password auth and organizations (Better Auth).
- **CLI** (`mobs`) — uploads EAS Update and native source maps so stack traces are symbolicated back to your original code.

**100% TypeScript.** Every source file — SDK, protocol, CLI, dashboard and example app — is TypeScript with `strict` and `noUncheckedIndexedAccess`; the only hand-written `.js` file is Expo's standard `apps/example/metro.config.js`. The CLI's committed `build/` is `tsc` output, never hand-written JS. Native crash capture is, by necessity, Swift/C on iOS and Kotlin/Java on Android.

---

## Architecture

Three moving parts, one Postgres database:

```
 ┌─────────────────────────────┐          ┌───────────────────────────────────────┐
 │   Your mobile app (Expo)    │          │   Your server (VPS, local, fleet)     │
 │                             │  HTTPS   │                                       │
 │  @mobile-observability/     │  gzipped │   Dashboard (Next.js 16)              │
 │  react-native SDK           │  batches │                                       │
 │                             │ ───────▶ │   /api/v1/envelope                    │
 │  • JS + native crashes      │          │   • ingest-key authentication         │
 │  • sessions                 │          │   • size / count limits, rate limit   │
 │  • startup + screen timings │          │   • zod validation                    │
 │  • network requests         │          │        │                              │
 │  • custom events            │          │        ▼                              │
 │                             │          │   fingerprint → group into issues     │
 └─────────────────────────────┘          │   symbolicate against source maps     │
        │  source maps (CI or            │        │                              │
        │  your machine)                 │        ▼                              │
 ┌──────┴──────────────┐                 │   ┌─────────────┐                     │
 │  mobs CLI           │ ──────────────▶ │   │  Postgres   │                     │
 │  (mobs sourcemaps   │  /api/v1/       │   └──────┬──────┘                     │
 │   upload-eas …)     │  sourcemaps     │          │  React Server Components   │
 └─────────────────────┘                 │          ▼                            │
                                         │   Dashboard UI                        │
                                         │   (accounts, organizations,           │
                                         │    projects, API keys)                │
                                         └───────────────────────────────────────┘
```

### The flow, step by step

1. **The SDK records** — the `Observe` API (and its automatic integrations) captures JS errors, promise rejections, native crashes, session lifecycle, launch/screen timings and network requests in a small ring buffer on the device.
2. **The SDK sends** — records are batched, gzipped and POSTed to `POST /api/v1/envelope` with the project's _public ingest key_. The queue survives offline periods and crashes: pending reports are sent on the next launch.
3. **The ingest pipeline validates** — the server authenticates the key, enforces size/count limits and per-key rate limits (429 with `Retry-After`), validates everything against the shared zod schema (`packages/protocol`), corrects clock skew and deduplicates events.
4. **Errors become issues** — each error gets a fingerprint and is grouped into an _issue_ (`ON CONFLICT` upsert with regression re-opening). If a source map matches the app version or EAS update, stack frames are symbolicated at ingest.
5. **You read it in the dashboard** — sign in (email/password, organizations), pick a project, browse what your apps reported. All pages are React Server Components reading directly from Postgres.

### Repository layout

| Path                    | What it is                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/protocol`     | Zod v4 envelope schema shared by the SDK and the server — the single contract                             |
| `packages/react-native` | The SDK: JS core plus iOS and Android native modules                                                      |
| `packages/cli`          | `mobs` — TypeScript source-map uploader compiled to ESM ([emmadal/mobs](https://github.com/emmadal/mobs)) |
| `apps/dashboard`        | The self-hosted dashboard: Next.js 16 App Router, Tailwind 4, Drizzle, Better Auth                        |
| `apps/example`          | An Expo 58 example app with buttons that deliberately produce every signal                                |

### Design rules worth knowing

- **One contract** — the envelope schema is a standalone package; the SDK and the server can evolve without breaking each other.
- **Server-first dashboard** — all dashboard data mutations are Next.js **Server Actions** and every page reads data on the server (an endpoint's request traces load on demand through a Server Action); there is no client-side data-fetching layer and no dashboard data API exposed to the browser. Authentication uses Better Auth's own route handlers.
- **Fail fast, stay cheap** — ingest enforces hard limits (payload size, event count, cardinality-capped URL templates, retention windows) so a noisy app or a bad deploy can't take your server down.
- **Private by design** — no request bodies, headers or query strings are stored, URLs are path-templated; error response bodies and users' phone numbers are only sent when the app opts in.

---

## Getting started (development)

Requirements: Node ≥ 22, pnpm ≥ 12, Docker.

```sh
pnpm install
docker compose up -d db                  # Postgres 18 on localhost:5433
cp apps/dashboard/.env.example apps/dashboard/.env
$EDITOR apps/dashboard/.env              # set BETTER_AUTH_SECRET (openssl rand -base64 32)
pnpm --filter @mobile-observability/dashboard db:migrate
pnpm dev                                 # dashboard on http://localhost:3000
```

Open `/signup` to set up the workspace: the first account owns it, and everyone else joins through invite links the owner creates in Settings → People. Then create a project in Settings and copy its ready-made `.env` block (see [Connect the app to the dashboard](#connect-the-app-to-the-dashboard-three-keys)).

## Self-hosting

One image serves every target — a laptop, a personal VPS, or an internal server fleet — because all configuration is runtime environment: the same build can be promoted across environments.

### With Docker Compose (local or VPS)

```sh
git clone https://github.com/emmadal/mobile-observability
cd mobile-observability
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
docker compose --profile app up -d --build
# dashboard on http://localhost:3000 (migrations run automatically first)
```

Without the `app` profile, compose only starts the development Postgres — that's what the local quickstart above uses.

### On a personal VPS

Run the compose stack behind a reverse proxy that terminates TLS (recommended by the [Next.js self-hosting guide](https://nextjs.org/docs/app/getting-started/deploying)). With Caddy:

```caddy
observability.example.com {
    reverse_proxy localhost:3000
}
```

Then set the public URL so Better Auth issues `__Secure-` cookies automatically:

```sh
export BETTER_AUTH_URL=https://observability.example.com
docker compose --profile app up -d --build
```

Hardening tips: keep the Postgres port off the public interface (drop the `5433:5432` mapping on a server), and let the proxy handle rate limiting and payload limits.

### On company infrastructure

- **External Postgres** (managed or self-managed): point `DATABASE_URL` at it, remove the local `db` service, and run migrations before starting the app: `docker build --target migrations -t mobs-migrate . && docker run --rm -e DATABASE_URL=postgres://… mobs-migrate`.
- **Multiple app instances** behind a load balancer: build and run every instance with the same `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (base64, 16/24/32 bytes) so Server Action encryption keys match, and consider a [shared cache handler](https://nextjs.org/docs/app/building-your-application/caching) for the Next.js cache.
- **Rolling deployments**: set `deploymentId` in `next.config.ts` to enable version-skew protection.
- **Email**: no provider ships by default. Verification links are logged in development; wire a provider in `apps/dashboard/src/lib/auth/mailer.ts` and set `MAIL_PROVIDER_CONFIGURED=true`.

### Updating

```sh
git pull
docker compose --profile app up -d --build   # rebuilds, re-runs migrations, restarts
```

Rollback: redeploy the previous commit; database migrations are expand-only per release (old app versions keep working).

## Using the SDK in your Expo app

```sh
npx expo install @mobile-observability/react-native
```

Then rebuild the native app (`npx expo run:ios` / `run:android`, or a new EAS build). Bare React Native apps run `npx install-expo-modules@latest` once first. Full setup: [`packages/react-native/README.md`](packages/react-native/README.md).

### Connect the app to the dashboard: three keys

Each project card in **Settings** shows the app's `.env` block, already filled with this dashboard's URL and the project's ingest key. The upload token is shown once, as a `MOBS_UPLOAD_TOKEN=` line, when the project is created or the token rotated:

| Variable                    | What it is                     | Used by                | Secret |
| --------------------------- | ------------------------------ | ---------------------- | ------ |
| `EXPO_PUBLIC_MOBS_ENDPOINT` | Dashboard URL                  | the app and `mobs` CLI | no     |
| `EXPO_PUBLIC_MOBS_KEY`      | Public ingest key (`mobs_pk_`) | the app                | no     |
| `MOBS_UPLOAD_TOKEN`         | Upload token (`mobs_sk_`)      | `mobs` CLI only        | yes    |

```sh
# .env: shipped inside the app bundle anyway, safe to commit
EXPO_PUBLIC_MOBS_ENDPOINT=https://observability.example.com
EXPO_PUBLIC_MOBS_KEY=mobs_pk_...

# .env.local: git-ignored; in CI or EAS use a secret / sensitive variable instead
MOBS_UPLOAD_TOKEN=mobs_sk_...
```

Never give the upload token the `EXPO_PUBLIC_` prefix: Expo inlines `EXPO_PUBLIC_*` values into the JS bundle, where anyone can read them. The ingest key can only send telemetry, so it is fine in the app. The CLI reads the same `.env` files, so on your machine the endpoint is configured once for both. In CI, set `EXPO_PUBLIC_MOBS_ENDPOINT` next to the `MOBS_UPLOAD_TOKEN` secret: a token from the environment is never sent to an endpoint that only a `.env` file names.

The API, as used by `apps/example`:

```tsx
// app/_layout.tsx
import { Observe, ObserveErrorBoundary, ObserveRoot } from '@mobile-observability/react-native';

// Expo only inlines EXPO_PUBLIC_* in your own code, so pass them here.
Observe.configure({
  apiKey: process.env.EXPO_PUBLIC_MOBS_KEY,
  endpoint: process.env.EXPO_PUBLIC_MOBS_ENDPOINT,
});

function RootLayout() {
  return (
    <ObserveErrorBoundary fallback={<Fallback />}>
      <Stack>…</Stack>
    </ObserveErrorBoundary>
  );
}

// ObserveRoot.wrap takes a component, not an element.
export default ObserveRoot.wrap(RootLayout);
```

What you get out of the box:

- **Crashes and errors** — uncaught JS errors, unhandled promise rejections and native crashes (SIGSEGV, `NSException`, JVM exceptions). A crash report is sent on the next launch.
- **Sessions** — lifecycle-tracked sessions with ok / errored / crashed status.
- **Performance** — cold/warm launch, bundle load, time-to-render and time-to-interactive.
- **Network** — `XMLHttpRequest` **and** the native `fetch` (expo/fetch) are tracked with status, timing and sizes; query strings are stripped and paths are templated (`/items/:id`). Each request opens as a trace on the dashboard: a **network failure** (no response, with the platform's message) or an **API error** (status, and the response body with `networkErrorBodiesEnabled: true`).
- **Users** — `Observe.setUser({ id, phone, segment })` links sessions to the signed-in user; the dashboard lists sessions with the user's phone number and counts users per segment (kyc, merchant…).
- **Control** — `Observe.logEvent`, `Observe.reportError`, `Observe.setUser`, `Observe.markInteractive`, sampling, `beforeSend`, `ignoreUrls`, and `Observe.dispatchEvents()` to flush on demand.

Dashboard pages refresh every 5 minutes by default; pick another interval, or off, in the toolbar.

## Uploading source maps

Symbolicated stack traces require the matching source map. After an EAS Update:

```sh
eas update --json > update.json
mobs sourcemaps upload-eas --dist dist --eas-json update.json
```

`mobs` takes `EXPO_PUBLIC_MOBS_ENDPOINT` and `MOBS_UPLOAD_TOKEN` from the environment or the project's `.env` / `.env.local`, so no flags are needed (`--endpoint` and `--token` still override them).

Or a single map:

```sh
mobs sourcemaps upload --platform ios --file ios/index.map \
  --app-version 1.4.2 --build 42
```

`mobs` is a standalone, zero-dependency TypeScript CLI published as `@mobile-observability/cli`. Full instructions, Expo and bare-RN workflows, and CI and Vercel integration live in [`packages/cli/README.md`](packages/cli/README.md):

```sh
npm install --save-dev @mobile-observability/cli
# or run without installing
npx --yes @mobile-observability/cli --help
```

Unreleased changes install from GitHub with `npm install --save-dev --install-links github:emmadal/mobs`.

## Privacy and security

- **Privacy** — no request bodies, headers or query strings are stored, and the SDK never sends the device's IP address or location (the dashboard records the ingest call's IP and CDN geo headers). URLs are reduced to path templates with a per-day cardinality cap. Error response bodies (`networkErrorBodiesEnabled`) and phone numbers (`Observe.setUser({ phone })`) are opt-in, and credential-like keys in error bodies are redacted on device.
- **Dashboard security** — follows the Next.js App Router security guidance: an optimistic session gate plus server-side re-verification in every page (`apps/dashboard/src/lib/auth/session.ts`), a per-request nonce CSP (`apps/dashboard/src/proxy.ts`), `server-only` data-access boundaries, Server Actions for every mutation, and sanitized same-origin redirects.
- **Report vulnerabilities** privately via a [GitHub security advisory](https://github.com/emmadal/mobile-observability/security/advisories/new) rather than a public issue.

## Development

```sh
pnpm check        # biome + tsc + vitest across the workspace
pnpm test         # unit + integration tests (dashboard tests use a real Postgres)
pnpm --filter @mobile-observability/dashboard test:e2e   # Playwright against a production build
```

- Dashboard integration tests run against `TEST_DATABASE_URL` (default `mobs_test` on port 5433); migrations are applied by the Vitest global setup.
- Dashboard end-to-end tests (`apps/dashboard/e2e/`, also run in CI) recreate a throwaway `mobs_e2e` database (`E2E_DATABASE_URL`), build and start the dashboard on port 3200, sign in, send SDK-shaped envelopes through the ingest endpoint, then check sign-in and sign-out, users per segment, sessions with phone numbers, network traces and issue resolution, failing on any console or CSP error. Run `pnpm exec playwright install chromium` once first.
- E2E scenarios for the example app live in `apps/example/e2e/` (Maestro): handled errors, network calls, JS-fatal and native crashes with relaunch.
- The dashboard targets Next.js 16, whose APIs differ from earlier releases; its documentation ships in `node_modules/next/dist/docs/`.

## Contributing

Issues and pull requests are welcome. Keep one task per commit (conventional commits), and make sure `pnpm check` passes before submitting.

## License

[MIT](LICENSE)
