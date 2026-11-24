# Changelog

All notable changes to `@mobile-observability/react-native`. Each section is
also published as the GitHub release for its `react-native-v<version>` tag.

## 0.2.1

### Fixed

- **Device info without the native module.** When the app binary does not
  contain the native module (Expo Go, or an OTA update running on a binary
  built before the SDK was added), the SDK now reads React Native's platform
  constants. Android reports the OS release ("14" instead of API level 34),
  manufacturer, model and emulator flag, iOS reports its version and device
  family, and both report the locale. The warning now names the OTA case.

## 0.2.0

### Added

- **Distributed tracing.** Every captured `fetch` and XHR request carries a
  W3C `traceparent` header. Request items report the `traceId`, so a mobile
  request can be matched with the backend trace, plus the time to first byte
  (`timeToFirstByteMs`) when the transport exposes it.
- **Connection type** (`wifi`, `cellular`, `ethernet`...) on captured requests.
- **JS thread hang detection.** A foreground stall of the JS thread is
  reported as a handled, non-fatal `hang` error, grouped into its own issue.
  Configure with `hangTrackingEnabled` (default `true`) and `hangThresholdMs`
  (default 2000 ms).
- **Device health sampling.** Every five minutes in the foreground the SDK
  emits an internal `$device.health` event with battery level and charging
  state, low power mode, thermal state, connection type, slow and frozen frame
  counters and the pending queue depth. Set `resourceSampleIntervalMs: 0` to
  disable it.
- **Connectivity transitions.** Internal `$net.offline` and `$net.online`
  events mark offline windows, so they can be correlated with failed requests.
- **On-device redaction.** `logEvent` attributes whose key looks like a
  credential, token, one-time code, card number or personal identifier are
  replaced with `[redacted]` before leaving the device.

### Fixed

- Envelopes report SDK version `0.2.0`; the Android library version matches.
- An app that starts offline no longer reports `$net.online`: the first
  connectivity reading only initializes the state, except that starting
  offline opens an offline window with `$net.offline`.

### Compatibility

- Requires `@mobile-observability/protocol` 0.2.0, installed automatically.
- Servers on protocol 0.1.0 accept 0.2.0 envelopes; they ignore the new
  request fields. The dashboard shows trace ids, TTFB and connection types
  once it runs the 0.2.0 schema.

## 0.1.1

### Fixed

- The Android module compiles: the crash reporter passed a `Long` timestamp
  where a `Double` was expected.

## 0.1.0

Initial release: crash and error reporting (JS and native), sessions, startup
and navigation metrics, network capture, custom events and offline queueing
for Expo and React Native apps.
