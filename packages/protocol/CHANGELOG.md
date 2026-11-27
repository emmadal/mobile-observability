# Changelog

All notable changes to `@mobile-observability/protocol`. Each section is also
published as the GitHub release for its `protocol-v<version>` tag.

## 0.3.0

### Added

- The envelope `user` accepts two optional fields next to `id`:
  - `phone`: the phone number (MSISDN) the app chose to attach, up to 32
    characters.
  - `segment`: an app-defined group of users (`kyc`, `merchant`...), up to 64
    characters.
- Request items accept two optional fields:
  - `errorMessage`: the platform's or the JS error's own message when no
    response arrived ("The request timed out."), up to 512 characters.
  - `responseBody`: the start of an error response body (status >= 400), up
    to `LIMITS.maxResponseBodyLength` (2048) characters.
- `userContextSchema` and the `UserContext` / `UserContextInput` types.

### Compatibility

- Additive only: 0.2 envelopes still validate, and the schema version stays
  `1`. Older servers strip the new fields.

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
