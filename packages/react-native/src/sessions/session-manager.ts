import type { SessionStatus } from '@mobile-observability/protocol';
import { uuid } from '../core/ids';

export interface SessionUpdate {
  sessionId: string;
  startedAt: number;
  endedAt?: number;
  status: SessionStatus;
  errorCount: number;
  init: boolean;
}

export interface SessionManagerOptions {
  timeoutMs: number;
  now: () => number;
  onUpdate: (update: SessionUpdate) => void;
}

/**
 * One session per foreground period: a new session starts on cold start and
 * when the app returns after at least `timeoutMs` in background (AC-8).
 */
export class SessionManager {
  private current: SessionUpdate | null = null;
  private backgroundedAt: number | null = null;

  constructor(private readonly options: SessionManagerOptions) {}

  get sessionId(): string | undefined {
    return this.current?.sessionId;
  }

  get status(): SessionStatus | undefined {
    return this.current?.status;
  }

  start(): void {
    this.current = {
      sessionId: uuid(),
      startedAt: this.options.now(),
      status: 'ok',
      errorCount: 0,
      init: true,
    };
    this.emit();
  }

  onBackground(): void {
    if (!this.current || this.backgroundedAt !== null) return;
    this.backgroundedAt = this.options.now();
    this.emit();
  }

  onForeground(): void {
    if (this.backgroundedAt === null) return;
    const away = this.options.now() - this.backgroundedAt;
    const endedAt = this.backgroundedAt;
    this.backgroundedAt = null;
    if (away >= this.options.timeoutMs) {
      this.end(endedAt);
      this.start();
    }
  }

  recordError(fatal: boolean): void {
    if (!this.current) return;
    this.current.errorCount += 1;
    if (fatal) this.current.status = 'crashed';
    else if (this.current.status === 'ok') this.current.status = 'errored';
    if (fatal) this.emit();
  }

  /**
   * Re-sends the current session unchanged, e.g. after sign-in, so the server
   * links it to the user without waiting for the session to background.
   */
  touch(): void {
    this.emit();
  }

  /** The update to persist with a fatal crash (the process will not live to send it). */
  snapshot(): SessionUpdate | null {
    return this.current ? { ...this.current } : null;
  }

  private end(endedAt: number): void {
    if (!this.current) return;
    this.current.endedAt = endedAt;
    this.emit();
    this.current = null;
  }

  private emit(): void {
    if (!this.current) return;
    this.options.onUpdate({ ...this.current });
    this.current.init = false;
  }
}
