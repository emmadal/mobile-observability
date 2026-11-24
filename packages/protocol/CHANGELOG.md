# Changelog

All notable changes to `@mobile-observability/protocol`. Each section is also
published as the GitHub release for its `protocol-v<version>` tag.

## 0.2.0

### Added

- Request items accept three optional fields:
  - `timeToFirstByteMs`: time to the first response byte.
  - `traceId`: W3C trace id the SDK propagated in the `traceparent` header.
  - `networkType`: connection type reported by the device (`wifi`,
    `cellular`...).

### Compatibility

- Additive only: 0.1.0 envelopes still validate, and the schema version stays
  `1`.

## 0.1.0

Initial release: the envelope schema shared by the SDK and the ingest server
(errors, sessions, metrics, requests and events), its validation with
`parseEnvelope`, and the protocol constants and limits.
