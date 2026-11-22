import {
  CURRENT_SCHEMA_VERSION,
  type EnvelopeInput,
  HEADERS,
  INGEST_PATHS,
  LIMITS,
} from '@mobile-observability/protocol';
import { gzipSync, strToU8 } from 'fflate';
import { backoffDelay, parseRetryAfter } from './backoff';
import type { Batch, PersistentQueue } from './queue';

export type HttpPost = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: Uint8Array },
) => Promise<{ status: number; headers: { get(name: string): string | null } }>;

export interface TransportOptions {
  endpoint: string;
  apiKey: string;
  sdk: { name: string; version: string };
  queue: PersistentQueue;
  post: HttpPost;
  now?: () => number;
  /** Max items per envelope. */
  batchSize?: number;
}

export type FlushResult = 'sent' | 'empty' | 'backoff' | 'retry' | 'dropped' | 'busy';

const MAX_ENVELOPE_JSON_BYTES = Math.floor(LIMITS.maxEnvelopeBytes * 0.9);
const NON_RETRYABLE = new Set([400, 401, 403, 404, 413, 422]);

/**
 * Sends queued items as gzip envelopes. 2xx removes the batch, 4xx (except
 * 408/429) drops it as poison, anything else backs off and retries (AC-9).
 */
export class Transport {
  private attempt = 0;
  private nextAttemptAt = 0;
  private inFlight = false;
  private readonly now: () => number;
  private readonly batchSize: number;

  constructor(private readonly options: TransportOptions) {
    this.now = options.now ?? Date.now;
    this.batchSize = Math.min(options.batchSize ?? 100, LIMITS.maxItemsPerEnvelope);
  }

  get envelopeUrl(): string {
    return `${this.options.endpoint.replace(/\/+$/, '')}${INGEST_PATHS.envelope}`;
  }

  /** Sends batches until the queue is empty or a send fails. */
  async flush(): Promise<FlushResult> {
    if (this.inFlight) return 'busy';
    this.inFlight = true;
    try {
      let result: FlushResult = 'empty';
      for (;;) {
        const step = await this.sendOne();
        if (step === 'empty') return result;
        result = step;
        if (step !== 'sent' && step !== 'dropped') return step;
      }
    } finally {
      this.inFlight = false;
    }
  }

  private async sendOne(): Promise<FlushResult> {
    const { queue } = this.options;
    if (queue.length === 0) return 'empty';
    if (this.now() < this.nextAttemptAt) return 'backoff';
    const batch = queue.nextBatch(this.batchSize, MAX_ENVELOPE_JSON_BYTES);
    if (!batch) return 'empty';

    let response: Awaited<ReturnType<HttpPost>>;
    try {
      response = await this.options.post(this.envelopeUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
          [HEADERS.apiKey]: this.options.apiKey,
        },
        body: gzipSync(strToU8(JSON.stringify(this.envelopeFor(batch)))),
      });
    } catch {
      this.scheduleRetry(null);
      return 'retry';
    }

    if (response.status >= 200 && response.status < 300) {
      this.attempt = 0;
      this.nextAttemptAt = 0;
      queue.remove(batch);
      return 'sent';
    }
    if (NON_RETRYABLE.has(response.status)) {
      queue.remove(batch);
      return 'dropped';
    }
    this.scheduleRetry(parseRetryAfter(response.headers.get('retry-after'), this.now()));
    return 'retry';
  }

  private scheduleRetry(retryAfterMs: number | null): void {
    const delay = retryAfterMs ?? backoffDelay(this.attempt);
    this.attempt += 1;
    this.nextAttemptAt = this.now() + delay;
  }

  envelopeFor(batch: Batch): EnvelopeInput {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      sentAt: this.now(),
      sdk: this.options.sdk,
      installationId: batch.context.installationId,
      app: batch.context.app,
      device: batch.context.device,
      ...(batch.context.user ? { user: batch.context.user } : {}),
      items: batch.items,
    };
  }
}
