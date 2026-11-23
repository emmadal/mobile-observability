# @mobile-observability/protocol

The wire protocol of [mobile-observability](https://github.com/emmadal/mobile-observability): the zod schema of the envelope the SDK sends, the metric names and limits, and the URL sanitizing rules. The SDK (`@mobile-observability/react-native`) and the ingest server both depend on it, so they always agree on the format.

You do not need to install it yourself: the SDK pulls it in.

```ts
import { CURRENT_SCHEMA_VERSION, LIMITS, sanitizeUrl } from '@mobile-observability/protocol';
import { parseEnvelope } from '@mobile-observability/protocol/schema';

sanitizeUrl('https://api.example.com/items/42?token=secret');
// { host: 'api.example.com', path: '/items/:id' }

const result = parseEnvelope(json); // { ok: true, envelope, droppedItems } or { ok: false, issues }
```

The server accepts the current `schemaVersion` and the one before it; unknown fields are stripped and unknown item types are dropped, so older and newer SDKs keep working.

## License

[MIT](https://github.com/emmadal/mobile-observability/blob/main/LICENSE)
