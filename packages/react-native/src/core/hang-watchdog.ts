/**
 * Detects a blocked JavaScript thread: a watchdog timer scheduled every
 * `intervalMs` fires late when the loop is stuck, and the measured lateness is
 * the minimum duration of the stall. Only foreground stalls are reported —
 * background suspensions are normal — and each stall is reported once.
 */
export interface HangWatchdogOptions {
  /** How often the watchdog ticks (default 250 ms). */
  intervalMs?: number;
  /** A stall shorter than this is noise, not a hang (default 2000 ms). */
  hangThresholdMs?: number;
  /** Foreground state: background suspensions are not hangs. */
  isForeground: () => boolean;
  /** Called once per detected stall with its approximated duration. */
  onHang: (durationMs: number) => void;
  /** Clock, injectable for tests (defaults to performance.now or Date.now). */
  now?: () => number;
}

export const DEFAULT_HANG_INTERVAL_MS = 250;
export const DEFAULT_HANG_THRESHOLD_MS = 2_000;

export class HangWatchdog {
  private timer: ReturnType<typeof setInterval> | null = null;
  private expectedAt = 0;
  private reported = false;

  constructor(private readonly options: HangWatchdogOptions) {}

  start(setIntervalFn: typeof setInterval, clearIntervalFn: typeof clearInterval): void {
    if (this.timer) return;
    const intervalMs = this.options.intervalMs ?? DEFAULT_HANG_INTERVAL_MS;
    this.expectedAt = this.now();
    this.timer = setIntervalFn(() => {
      const now = this.now();
      const lateMs = now - this.expectedAt;
      this.expectedAt = now;
      const threshold = this.options.hangThresholdMs ?? DEFAULT_HANG_THRESHOLD_MS;
      if (lateMs < threshold || !this.options.isForeground()) {
        // Short stalls and background suspensions are not hangs.
        this.reported = false;
        return;
      }
      if (this.reported) return;
      this.reported = true;
      this.options.onHang(Math.round(lateMs));
    }, intervalMs);
  }

  stop(clearIntervalFn: typeof clearInterval): void {
    if (!this.timer) return;
    clearIntervalFn(this.timer);
    this.timer = null;
  }

  private now(): number {
    if (this.options.now) return this.options.now();
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }
}
