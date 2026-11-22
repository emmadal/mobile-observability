/**
 * Per-key token bucket (default 100 requests/s, burst 200). In-memory, so the
 * limit applies per server instance.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(
    private readonly ratePerSecond = 100,
    private readonly burst = 200,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns 0 when allowed, otherwise the ms to wait before retrying. */
  take(key: string): number {
    const now = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.burst, updatedAt: now };
    const elapsedSeconds = (now - bucket.updatedAt) / 1000;
    bucket.tokens = Math.min(this.burst, bucket.tokens + elapsedSeconds * this.ratePerSecond);
    bucket.updatedAt = now;
    this.buckets.set(key, bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return 0;
    }
    return Math.ceil(((1 - bucket.tokens) / this.ratePerSecond) * 1000);
  }
}
