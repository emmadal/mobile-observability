import { describe, expect, it } from 'vitest';
import { HangWatchdog } from './hang-watchdog';

/** Manual clock: tests drive ticks directly instead of waiting on timers. */
function setup(options: { threshold?: number; foreground?: boolean } = {}) {
  let tick: (() => void) | null = null;
  let now = 0;
  const watchdog = new HangWatchdog({
    hangThresholdMs: options.threshold ?? 2_000,
    isForeground: () => options.foreground ?? true,
    onHang: (durationMs) => hangs.push(durationMs),
    now: () => now,
  });
  const hangs: number[] = [];
  watchdog.start(
    ((_handler: () => void, _ms: number) => {
      tick = _handler;
      return 0 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval,
    (() => undefined) as typeof clearInterval,
  );
  return {
    hangs,
    advance(ms: number) {
      now += ms;
      tick?.();
    },
    time: () => now,
    stop: () => watchdog.stop(() => undefined),
  };
}

describe('HangWatchdog', () => {
  it('reports a stall longer than the threshold once', () => {
    const watchdog = setup({ threshold: 2_000 });
    watchdog.advance(250); // normal tick
    expect(watchdog.hangs).toEqual([]);
    watchdog.advance(2_400); // blocked well past the threshold
    expect(watchdog.hangs).toEqual([2_400]);
    watchdog.stop();
  });

  it('does not re-report the same stall on the next tick', () => {
    const watchdog = setup({ threshold: 2_000 });
    watchdog.advance(2_500);
    watchdog.advance(250);
    watchdog.advance(250);
    expect(watchdog.hangs).toEqual([2_500]);
    watchdog.stop();
  });

  it('reports a new stall after recovery', () => {
    const watchdog = setup({ threshold: 2_000 });
    watchdog.advance(2_500);
    // Ticks arrive on time: the thread recovered, the flag clears.
    watchdog.advance(250);
    watchdog.advance(250);
    watchdog.advance(3_000);
    expect(watchdog.hangs).toEqual([2_500, 3_000]);
    watchdog.stop();
  });

  it('ignores stalls that happen while the app is backgrounded', () => {
    const watchdog = setup({ threshold: 2_000, foreground: false });
    watchdog.advance(5_000);
    expect(watchdog.hangs).toEqual([]);
    watchdog.stop();
  });

  it('ignores short stalls below the threshold', () => {
    const watchdog = setup({ threshold: 2_000 });
    for (let index = 0; index < 6; index += 1) watchdog.advance(1_900);
    expect(watchdog.hangs).toEqual([]);
    watchdog.stop();
  });
});
