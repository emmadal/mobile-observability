# mobile-observability

Open-source observability for React Native and Expo apps: crash reporting (JS + native), error grouping with source-map symbolication, sessions, and performance metrics (startup, screens, network) — with a self-hosted dashboard you own.

- **SDK** (`@mobile-observability/react-native`) — Expo-native module, drop-in `Observe` API mirroring `expo-observe`, offline-first queue, batched gzip transport.
- **Dashboard** (Next.js 16 App Router) — Better Auth email/password with organizations, issues, sessions and performance pages against your own Postgres.
- **CLI** (`mobs`) — uploads EAS Update and native source maps for symbolication.

## Monorepo layout

| Path                    | What it is                                                          |
| ----------------------- | ------------------------------------------------------------------- |
| `packages/protocol`     | Zod envelope schema shared by the SDK and the dashboard             |
| `packages/react-native` | The SDK (JS + iOS/Android native modules) and the `mobs` CLI        |
| `apps/dashboard`        | Next.js 16 dashboard (App Router, Tailwind 4, Drizzle, Better Auth) |
| `apps/example`          | Expo 58 example app with buttons that produce every signal          |

## Quickstart (dashboard)

Requirements: Node ≥ 22, pnpm ≥ 12, Docker.

```sh
pnpm install
docker compose up -d db          # Postgres 18 on localhost:5433
cp apps/dashboard/.env.example apps/dashboard/.env
# generate a secret: openssl rand -base64 32
$EDITOR apps/dashboard/.env
pnpm --filter @mobile-observability/dashboard db:migrate
pnpm dev                         # dashboard on http://localhost:3000
```

Sign up at `/signup` (creating your account also creates your organization), create a project, and copy the ingest key from Settings.

## Using the SDK in your Expo app

```sh
npx expo install @mobile-observability/react-native
```

```tsx
// app/_layout.tsx
import { Observe, ObserveErrorBoundary, ObserveRoot } from '@mobile-observability/react-native';

Observe.configure({
  apiKey: '<your ingest key>',
  endpoint: 'https://observability.example.com',
});

export default ObserveRoot.wrap(
  <ObserveErrorBoundary fallback={<Fallback />}>
    <Stack>…</Stack>
  </ObserveErrorBoundary>,
);
```

What you get out of the box:

- Uncaught JS errors, unhandled promise rejections and native crashes (SIGSEGV / `NSException` / JVM exceptions), reported on the next launch after a crash.
- Sessions with ok / errored / crashed status and a 30 s background timeout.
- Cold / warm launch, bundle load, time-to-render and time-to-interactive metrics.
- Network tracking for `XMLHttpRequest` **and** the native `fetch` (expo/fetch), with query strings stripped and paths templated (`/items/:id`).
- `Observe.logEvent`, `Observe.reportError`, `Observe.setUser`, sampling, `beforeSend`, `ignoreUrls` and a remote kill switch (`enabled` + sample rates) honored with a 1 h cache.

Privacy: no request/response bodies, no headers, no query strings and no IP addresses are stored — enforced by tests (T32).

## Uploading source maps

Symbolicated stack traces require the matching source map. After an EAS Update:

```sh
eas update --json > update.json
mobs sourcemaps upload-eas --dist dist --eas-json update.json \
  --endpoint https://observability.example.com \
  --token <project upload token>
```

Or a single map:

```sh
mobs sourcemaps upload --platform ios --file ios/index.map \
  --app-version 1.4.2 --build 42
```

`mobs` is shipped in the `@mobile-observability/react-native` package (`pnpm exec mobs --help`).

## Development

```sh
pnpm check        # biome + tsc + vitest across the workspace
pnpm test         # unit + integration tests (dashboard tests use a real Postgres)
```

- Dashboard integration tests run against `TEST_DATABASE_URL` (default `mobs_test` on port 5433); migrations are applied by the Vitest global setup.
- E2E scenarios for the example app live in `apps/example/e2e/` (Maestro): handled errors, network, JS-fatal and native crashes with relaunch.
- The dashboard uses **Server Actions** for every mutation (auth, settings) and React Server Components for data; API routes exist only for SDK ingest (`/api/v1/*`, key-authed) and Better Auth endpoints.

## Security

The dashboard follows the Next.js App Router security guidance: a proxy-level optimistic session gate plus server-side re-verification in every page (`src/lib/auth/session.ts`), a per-request nonce CSP set in `src/proxy.ts`, `server-only` data access boundaries, and sanitized same-origin redirects. Please report vulnerabilities privately via a [GitHub security advisory](https://github.com/mobile-observability/mobile-observability/security/advisories/new) rather than a public issue.

## License

[MIT](LICENSE)
