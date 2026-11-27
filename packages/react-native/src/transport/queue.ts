import type {
  AppContextInput,
  DeviceContextInput,
  ItemInput,
  UserContextInput,
} from '@mobile-observability/protocol';

/** Envelope-level context. Items recorded under different contexts are sent in separate envelopes. */
export interface EnvelopeContext {
  installationId: string;
  app: AppContextInput;
  device: DeviceContextInput;
  user?: UserContextInput;
}

interface QueueEntry {
  contextKey: string;
  item: ItemInput;
  size: number;
}

interface PersistedQueue {
  version: 1;
  contexts: Record<string, EnvelopeContext>;
  entries: QueueEntry[];
}

export interface QueueStorage {
  get(key: string): string | null;
  set(key: string, value: string | null): Promise<void>;
}

export interface QueueLimits {
  maxItems: number;
  maxBytes: number;
}

export const DEFAULT_QUEUE_LIMITS: QueueLimits = { maxItems: 1000, maxBytes: 5 * 1024 * 1024 };

export interface Batch {
  context: EnvelopeContext;
  items: ItemInput[];
  /** Number of leading queue entries of this context included in the batch. */
  entryCount: number;
  contextKey: string;
}

const STORAGE_KEY = 'queue.v1';

export function contextKeyOf(context: EnvelopeContext): string {
  return JSON.stringify([
    context.installationId,
    context.app,
    context.device,
    context.user ?? null,
  ]);
}

/**
 * Disk-backed FIFO of items waiting for upload (AC-9). Oldest items are dropped
 * first when over the cap; items leave the queue only after a 2xx.
 */
export class PersistentQueue {
  private contexts: Record<string, EnvelopeContext> = {};
  private entries: QueueEntry[] = [];
  private bytes = 0;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  droppedCount = 0;

  constructor(
    private readonly storage: QueueStorage,
    private readonly limits: QueueLimits = DEFAULT_QUEUE_LIMITS,
  ) {
    this.restore();
  }

  get length(): number {
    return this.entries.length;
  }

  get sizeInBytes(): number {
    return this.bytes;
  }

  enqueue(context: EnvelopeContext, item: ItemInput, options: { persistNow?: boolean } = {}): void {
    const contextKey = contextKeyOf(context);
    this.contexts[contextKey] = context;
    const size = JSON.stringify(item).length;
    this.entries.push({ contextKey, item, size });
    this.bytes += size;
    this.enforceLimits();
    if (options.persistNow) void this.persist();
    else this.schedulePersist();
  }

  /** The oldest items that share one context, bounded by count and bytes. */
  nextBatch(maxItems: number, maxBytes: number): Batch | null {
    const first = this.entries[0];
    if (!first) return null;
    const context = this.contexts[first.contextKey];
    if (!context) return null;
    const items: ItemInput[] = [];
    let bytes = 0;
    for (const entry of this.entries) {
      if (entry.contextKey !== first.contextKey) break;
      if (items.length >= maxItems || (items.length > 0 && bytes + entry.size > maxBytes)) break;
      items.push(entry.item);
      bytes += entry.size;
    }
    return { context, items, entryCount: items.length, contextKey: first.contextKey };
  }

  /** Removes a batch previously returned by `nextBatch`. */
  remove(batch: Batch): void {
    const removed = this.entries.splice(0, batch.entryCount);
    for (const entry of removed) this.bytes -= entry.size;
    this.pruneContexts();
    void this.persist();
  }

  clear(): void {
    this.entries = [];
    this.contexts = {};
    this.bytes = 0;
    void this.persist();
  }

  async persist(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    const snapshot: PersistedQueue = {
      version: 1,
      contexts: this.contexts,
      entries: this.entries,
    };
    await this.storage.set(STORAGE_KEY, this.entries.length > 0 ? JSON.stringify(snapshot) : null);
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persist();
    }, 250);
  }

  private enforceLimits(): void {
    while (
      this.entries.length > this.limits.maxItems ||
      (this.bytes > this.limits.maxBytes && this.entries.length > 1)
    ) {
      const dropped = this.entries.shift();
      if (!dropped) break;
      this.bytes -= dropped.size;
      this.droppedCount += 1;
    }
    this.pruneContexts();
  }

  private pruneContexts(): void {
    const used = new Set(this.entries.map((entry) => entry.contextKey));
    for (const key of Object.keys(this.contexts)) {
      if (!used.has(key)) delete this.contexts[key];
    }
  }

  private restore(): void {
    const raw = this.storage.get(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as PersistedQueue;
      if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return;
      this.contexts = parsed.contexts ?? {};
      this.entries = parsed.entries.filter((entry) => this.contexts[entry.contextKey]);
      this.bytes = this.entries.reduce((total, entry) => total + entry.size, 0);
      this.enforceLimits();
    } catch {
      // Corrupt queue file: start empty rather than crash.
    }
  }
}
