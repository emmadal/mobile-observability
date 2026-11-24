# @mobile-observability/react-native

Crash reporting, error grouping, sessions, startup and screen performance, and network monitoring for Expo and React Native apps. Everything is sent to the [mobile-observability](https://github.com/emmadal/mobile-observability) dashboard that you host yourself: no vendor, no data leaving your infrastructure.

The public API mirrors `expo-observe`, so switching is mostly a change of import.

**Status: beta (v0.2).**

## Requirements

- Expo SDK ≥ 56, or React Native ≥ 0.83 with the New Architecture
- iOS 16.4 or later, Android
- A running dashboard and the project's **ingest key** (dashboard: Settings, project card)

Bare React Native apps need Expo modules once: `npx install-expo-modules@latest`.

## Install

```sh
npx expo install @mobile-observability/react-native
```

Then rebuild the native app (`npx expo run:ios`, `npx expo run:android`, or a new EAS build): native crash capture and launch timings live in a native module. In Expo Go the SDK still reports JS errors, requests, screens and sessions, and warns once that the native module is missing.

Installing the SDK adds only the SDK, its wire-protocol package and a gzip library to your app. The dashboard and its database run on your server, never in the app.

## Configure

```tsx
// app/_layout.tsx
import { Observe, ObserveErrorBoundary, ObserveRoot } from '@mobile-observability/react-native';

Observe.configure({
  apiKey: '<your ingest key>',
  endpoint: 'https://observability.example.com',
  integrations: { 'expo-router': true },
});

function RootLayout() {
  return (
    <ObserveErrorBoundary fallback={<Fallback />}>
      <Stack />
    </ObserveErrorBoundary>
  );
}

// ObserveRoot.wrap takes a component, not an element.
export default ObserveRoot.wrap(RootLayout);
```

Call `Observe.configure()` at module scope: once the root has mounted it throws. The same options can live in `app.json` under `expo.extra.observability`.

Useful options: `sampleRate` (0 to 1, decided once per installation), `environment`, `beforeSend` (edit or drop an error), `ignoreUrls`, `sessionTimeoutMs`, `dispatchInDebug` (debug builds send nothing unless `true`), `enabled`. Collection toggles: `errorHandlingEnabled`, `networkTrackingEnabled`, `hangTrackingEnabled` (with `hangThresholdMs`, default 2000) and `resourceSampleIntervalMs` (default 300000, `0` disables).

## What it records

- **Crashes and errors**: uncaught JS errors, unhandled promise rejections, native crashes (signals, `NSException`, JVM exceptions), ANR-like **JS thread hangs** over two seconds, and out-of-memory reports. A crash report is sent on the next launch.
- **Sessions**: lifecycle-tracked sessions with ok, errored, abnormal and crashed status.
- **Performance**: cold and warm launch, bundle load, time to first render and time to interactive, plus slow/frozen frame counters and device state (battery, thermal, low power mode) sampled every five minutes as `$device.health` events.
- **Network**: `XMLHttpRequest` and the native `fetch` (expo/fetch), with status, timing, sizes, **time to first byte** and the **connection type** (wifi, cellular…). Query strings are stripped and paths are templated (`/items/:id`). Every request gets a fresh **W3C trace id** injected as a `traceparent` header, so mobile requests join their backend traces.
- **Events**: `Observe.logEvent(name, { attributes, body, severity, displayName })`.
- **Offline**: connectivity transitions are recorded as `$net.offline` / `$net.online` events, and envelopes queue while offline.

## Screens and navigation

**Expo Router**: set `integrations: { 'expo-router': true }` as above. Pass `{ filteredParams: ['token'] }` instead of `true` to keep some route params out of reports.

**React Navigation**: replace `NavigationContainer` with the drop-in container:

```tsx
import { ObserveNavigationContainer } from '@mobile-observability/react-native/integrations/react-navigation';

<ObserveNavigationContainer>{/* your navigators */}</ObserveNavigationContainer>;
```

**Time to interactive**: call `useObserve().markInteractive()` when a screen is usable, or render `<ObserveInteractiveMarker />`. The first call records the app's time to interactive; calls inside a screen also record that screen's.

## API

| Call                                                | What it does                                      |
| --------------------------------------------------- | ------------------------------------------------- |
| `Observe.configure(config)`                         | Sets the endpoint, key and options (module scope) |
| `Observe.reportError(error, { tags })`              | Reports a handled error, returns its event id     |
| `Observe.logEvent(name, options)`                   | Records a custom event                            |
| `Observe.setUser({ id })` / `Observe.setUser(null)` | Attaches a user id (no other personal data)       |
| `Observe.markInteractive()`                         | App-level time to interactive, outside screens    |
| `Observe.dispatchEvents()`                          | Sends everything queued now                       |
| `ObserveRoot.wrap(Component)`                       | Records time to first render                      |
| `<ObserveErrorBoundary fallback onError>`           | Reports render errors and shows a fallback        |

## Readable stack traces

Release builds report minified frames. Upload your source maps with the CLI and the dashboard shows the original `file:line`:

```sh
npm install --save-dev @mobile-observability/cli
npx mobs sourcemaps upload-eas --dist dist --eas-json update.json
```

See [`@mobile-observability/cli`](https://www.npmjs.com/package/@mobile-observability/cli) for EAS Update and bare React Native workflows.

## Privacy

The SDK never reads request or response bodies, headers or query strings, and never sends the device's IP address or location. URLs are reduced to host and path templates. Log-event attribute keys that look like credentials or payment data (`password`, `token`, `card`…) are redacted on device before anything leaves the app. The dashboard itself may record the request IP and CDN geo headers of the ingest call.

## License

[MIT](https://github.com/emmadal/mobile-observability/blob/main/LICENSE)
