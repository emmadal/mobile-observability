# Spec: Mobile Observability Platform (v1)

Status: Approved · Date: 2026-11-22 · Owner: emmadal

## 1. Problem

Teams shipping Expo / React Native apps cannot see production crashes, native failures, slow startups, slow screens and failing requests in one place. When a crash appears they also cannot tell quickly whether the fix can ship as an **OTA update** (JS-only) or **needs a new store build** (native), which decides between a fix in minutes and one in days. We need a self-owned platform: one SDK installed in the app, one dashboard that groups errors by cause, symbolicates stack traces to `file:line`, and reports startup and screen performance as P50/P90/P99 distributions.

## 2. Goals / Non-goals

**Deliverables (pnpm + Turborepo monorepo)**

- `packages/protocol`: shared zod schemas and types for the event envelope (single source of truth for SDK and server).
- `packages/react-native` (`@mobile-observability/react-native`): TS core + native module (Swift/Kotlin) + CLI `mobs` for source map upload.
- `apps/dashboard`: Next.js 16.4 (App Router), React 19.3, Tailwind CSS 4.3, shadcn/ui, Postgres via Drizzle. Hosts the ingest API and the UI.
- `apps/example`: Expo SDK 58 / RN 0.88 app used for end-to-end verification.

**Goals**: capture JS errors, native crashes and native issues (ANR, hang, OOM kill); group by cause; symbolicate JS stacks; label each issue "OTA update" or "new build"; track sessions and crash-free rates; instrument network requests; measure the five startup metrics (cold launch, warm launch, bundle load, TTR, TTI) and per-screen TTR with P50/P90/P99.

**Non-goals (v1)**: session replay; alerting and notifications; log search; backend distributed tracing; web/desktop SDKs; native symbolication of iOS dSYM / Android R8 mappings (see OQ-3); SSO, RBAC beyond owner/member, billing; the legacy RN architecture (New Architecture only).

**Parity with `expo-observe`** (decided 2026-11-22): the SDK mirrors its public API so teams can switch with a find-and-replace of the import. That API is `ObserveRoot.wrap(App)` (auto TTR), `useObserve().markInteractive({ routeName, params })`, `<ObserveInteractiveMarker />`, `Observe.configure({ sampleRate, dispatchInDebug, environment, integrations: { 'expo-router' | 'react-navigation': true | { filteredParams } } })`, `Observe.logEvent(name, { attributes, body, severity, displayName })`, `Observe.reportError`, `ObserveErrorBoundary`, `Observe.dispatchEvents()`, and `ObserveNavigationContainer` / `ObserveNavigationProvider`. The metric names are the same: `app_startup.{cold_launch_time, warm_launch_time, bundle_load_time, ttr, tti}` and `navigation.{cold_ttr, warm_ttr, tti}`. The dashboard shows Observe's target thresholds: cold <1.5 s, warm <0.5 s, bundle <0.3 s, TTR <2 s, TTI <3 s. Beyond Observe we add crash/error reporting, grouping, symbolication, sessions and request monitoring.

**Metric definitions** (stored in ms, displayed in s; one sample per launch unless stated)

- Cold launch: OS process start until the first frame drawn with RN root content.
- Warm launch: foreground with the process already alive (Android Activity recreated / iOS scene reconnect) until the next frame drawn.
- Bundle load: JS bundle load start until bundle evaluation ends (native markers).
- TTR: process start until the first screen's root view first layout. Per-screen TTR: navigation dispatch until the focused screen's first layout, keyed by route pattern (`/product/[id]`).
- TTI: process start until the app calls `markInteractive()`. Later calls are ignored. Not recorded if never called.
- Percentiles: `percentile_cont` (linear interpolation).

## 3. Acceptance criteria (test level: U unit, I integration API+DB, E end-to-end, P perf)

SDK

- AC-1 `init({ apiKey, endpoint })` configures once; a second call is a no-op with one warning. [U]
- AC-2 An uncaught JS error yields an event with type, message, frames, `origin:"js"`, `fatal`, context {appVersion, buildNumber, platform, osVersion, device model, runtimeVersion, updateId, channel} and the last ≤100 breadcrumbs. [U]
- AC-3 An unhandled promise rejection is captured as a non-fatal `origin:"js"` event; `captureException(err, { tags })` returns the eventId. [U]
- AC-4 Native issues are reported on the next launch with `origin:"native"`: iOS NSException + fatal signals and MetricKit crash/hang diagnostics; Android uncaught JVM exceptions and `ApplicationExitInfo` (API 30+) native crash, ANR, low-memory kill. A fatal crash marks its session `crashed`. Pending crash reports are sent within 5 s of the next `init`. [E]
- AC-5 `fetch` and XHR are auto-instrumented: method, host, path with query and fragment stripped, templated path (numeric, UUID and ≥16-hex segments become `:id`), status (0 on network failure), duration, response size. Calls to the SDK endpoint and URLs matching `ignoreUrls` are not recorded. [U]
- AC-6 Each of the five startup metrics is emitted at most once per launch, as defined in §2. [U, E]
- AC-7 With the Expo Router or React Navigation integration, every screen focus emits `screen.ttr` keyed by route pattern, never by concrete path. [U]
- AC-8 A new session starts on cold start and on foreground after ≥30 s in background (configurable). Status is `ok`, `errored` or `crashed`. [U]
- AC-9 Transport: flush every 10 s, at 50 events or on background; gzip body. The queue is persisted to disk and survives restart, capped at 1,000 events / 5 MB with oldest dropped first. Retry uses exponential backoff with jitter (1 s to 5 min) and honors `Retry-After`. An event is deleted only after a 2xx. [U]
- AC-10 Without the native module (Expo Go): init succeeds with one warning, AC-2/3/5/7/8 still work, native-only metrics are absent, and nothing throws. [U]
- AC-11 `beforeSend` can mutate an event or drop it (`null`). `sampleRate` is decided per installation (stable install id hash), so 0 sends nothing and 1 sends everything. Debug builds (`__DEV__` or a native debug build) dispatch nothing unless `dispatchInDebug: true`. [U]
- AC-12 The SDK adds ≤50 ms to median cold launch versus the same release build without it (10 runs, same device). [P]

Ingest and processing

- AC-13 `POST /api/v1/envelope`: valid key and ≤1 MB decompressed / ≤500 events → 202; bad or revoked key → 401; schema error → 400 with field path; oversize → 413; over the per-key rate limit → 429 with `Retry-After`. [I]
- AC-14 A duplicate `eventId` (client retry) is stored once. [I]
- AC-15 When |receivedAt − sentAt| > 60 s, event timestamps are shifted by that skew. [U]
- AC-16 The current and previous `schemaVersion` are accepted; unknown fields are ignored. [U]
- AC-17 Ingest p95 ≤250 ms for 100-event batches at 50 req/s sustained for 5 min (local Docker Postgres). [P]
- AC-18 Fingerprint = sha256(type + top 5 in-app frames as file+function). Line, column and message are excluded. With no frames, the fallback is type + message with numbers, UUIDs and hex normalized. The same frames with different messages give 1 issue; a different top in-app function gives 2 issues. [U]
- AC-19 After `mobs sourcemaps upload` (secret token, keyed by updateId, or by appVersion+build+platform for the embedded bundle), an error from that bundle shows the original `file:line:col`, the function and ±5 source lines when `sourcesContent` exists. Without a map, raw frames get an "Unsymbolicated" badge; a map uploaded later is applied when the issue is viewed. [I]
- AC-20 Issues with `origin:"js"` show "Fix via OTA update"; `origin:"native"` shows "Needs new build". [U, E]
- AC-21 Issue states are open, resolved and ignored. A new event after `resolvedAt` reopens the issue and flags it `regressed`. [I]

Dashboard

- AC-22 Pages: Overview, Issues, Issue detail, Sessions, Session detail, Startup, Screens, Network, Releases, Settings. All require login; an unauthenticated visitor is redirected to `/login`. [E]
- AC-23 Startup shows, for each of the 5 metrics, P50/P90/P99, sample count, a histogram and a P50/P90/P99 time series. For values 1..100 the page shows 50.5 / 90.1 / 99.01. Filters: range (1h/24h/7d/30d), platform, app version, updateId. [U, I, E]
- AC-24 Screens lists routes with count and P50/P90/P99 TTR, sorted by P90 descending by default (slowest first). [I, E]
- AC-25 Network groups by method+host+templated path with count, error rate (status 0 or ≥400) and P50/P90/P99 duration. [I]
- AC-26 Issues list shows title, culprit (`file:line`), fix badge, events, users, sessions, first/last seen and affected releases. It sorts by last seen or events and searches by title. [E]
- AC-27 Sessions shows crash-free sessions % and crash-free users % per release. Session detail shows a chronological timeline of screens, requests, errors and app state, ending in the crash marker for crashed sessions. [I, E]
- AC-28 Every page responds with p95 ≤1.5 s over a 7-day window with 5M perf rows and 500k error events seeded. [P]
- AC-29 axe-core reports 0 serious or critical violations per page; every chart has a table fallback; all controls are keyboard-operable; light and dark themes are supported. [E]
- AC-30 Creating a project shows a public ingest key and a secret upload token. After a rotation, the old key gets 401 within 60 s. [I]
- AC-31 Privacy: request/response bodies, headers, query strings and IP addresses are never stored. Ingest keys cannot read data. Accessing another org's project returns 404. [U, I]
- AC-33 Public API parity: every `expo-observe` export listed in §2 exists with the same signature. `Observe.configure()` after the root mounts throws. `markInteractive` records only its first call per session. [U]
- AC-34 Navigation: the first render of a route in a process emits `navigation.cold_ttr` (`isAppLaunch:true` when measured from process start); a later visit emits `navigation.warm_ttr`; `useObserve().markInteractive()` inside a screen emits `navigation.tti`. Params are `routeName` (pattern), `url` and `routeParams`; `filteredParams` keys are removed, and then `url` is dropped with `urlHidden:true`. [U]
- AC-35 TTI carries automatic params: `frameRate.{slowFrames ≥17 ms, frozenFrames ≥700 ms, totalDelay}`, `device.{lowPowerMode, thermalState, batteryLevel, batteryCharging}`, `network.{connected, type}`, and a summary of requests made between launch and TTI (`count`, `failed`, `bytesReceived`, `totalDuration`, `slowest.{duration, host, statusCode}`). [U, E]
- AC-36 `Observe.logEvent` events are listed on an Events page grouped by `name`, with count, severity and attribute breakdown, and appear in the session timeline under `displayName`. [I, E]
- AC-32 An owner can invite members by email. A member can view all projects, but rotating keys, deleting a project or managing members returns 403. [I]

## 4. Edge cases

- iOS prewarm (`ActivePrewarm=1`): the cold launch sample is discarded, not inflated.
- Crash during crash write: a partial file fails its checksum, is discarded and counted. Crash loop at start: pending reports are sent before other queue items.
- App killed mid-flush: at-least-once delivery plus eventId dedupe gives effectively-once.
- Concurrent first-seen of one fingerprint: issue upsert `ON CONFLICT (project_id, fingerprint)`.
- Stack overflow: keep the top 100 frames. Message capped at 1 KB, breadcrumb data at 2 KB, event at 64 KB.
- URL cardinality: cap 2,000 templates per project per day; overflow goes to `other`.
- OTA rollback to the embedded bundle: `updateId` changes and events are attributed to the bundle that actually ran.
- Source map: re-upload overwrites (last wins); 50 MB max per file; Hermes bytecode maps supported.
- Session never ended (process killed): it closes at the last event time after 24 h idle.
- Offline for days: the queue cap applies, and the server drops events older than retention (30 d).
- Old SDKs: `sdk.version` and `schemaVersion` are stored, and old envelopes are processed by the AC-16 rule.
- Web platform (react-native-web): the SDK is a no-op with one warning.
- Migrations: Drizzle, forward-only, expand/contract across one release. Retention deletes run in batches of 10k to avoid long locks.
- Time is stored in UTC and rendered in the viewer's locale.

## 5. Rollout

- Stage 0 (local): `docker compose up` (Postgres) plus `pnpm dev`. The example app reports to the local dashboard, and all U/I/E tests are green.
- Stage 1 (dogfood): SDK `0.1.0-beta` on npm tag `next`, one internal app.
- Stage 2: SDK `1.0.0` on `latest`.
- Kill switch: `GET /api/v1/config` returns `{ enabled, errorSampleRate, perfSampleRate }` per project, toggled in Settings and cached for 1 h on device, so the SDK can be disabled without an app release.
- Rollback: redeploy the previous dashboard build (schema stays compatible); for the SDK, use the kill switch, or an OTA update that pins the previous SDK JS (a native change needs a build).

## 6. Open questions

| #    | Question                                                                                                                                    | Owner   | Blocks      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------- |
| OQ-1 | ~~Storage~~ **Resolved 2026-11-22:** Postgres only. The repository layer keeps a ClickHouse swap possible later.                            | emmadal | —           |
| OQ-2 | ~~Native layer~~ **Resolved:** Expo Modules API. Bare RN apps run `npx install-expo-modules` once.                                          | emmadal | —           |
| OQ-3 | ~~Native symbolication~~ **Resolved:** v2. v1 symbolicates JS only; native frames stay raw (iOS image + offset, Android class.method:line). | emmadal | —           |
| OQ-4 | ~~Auth~~ **Resolved:** Better Auth email/password, one org, owner/member roles, invites, many projects.                                     | emmadal | —           |
| OQ-5 | Deploy target and managed Postgres provider                                                                                                 | emmadal | Stage 1     |
| OQ-6 | Final product name / npm scope                                                                                                              | emmadal | npm publish |
| OQ-7 | Retention (30 d) and rate limit (default 100 req/s per key): confirm                                                                        | emmadal | Stage 1     |
