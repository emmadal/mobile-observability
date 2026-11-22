import { describe, expect, it } from 'vitest';
import type { LaunchInfo } from '../native/types';
import { StartupCollector, type StartupMetric, type StartupTiming } from './startup';

function setup(launch: LaunchInfo | null, timing: StartupTiming | null = null) {
  const clock = { now: 5_000 };
  const metrics: StartupMetric[] = [];
  const collector = new StartupCollector({
    now: () => clock.now,
    launchInfo: () => launch,
    startupTiming: () => timing,
    sdkLoadedAt: 4_000,
    onMetric: (metric) => metrics.push(metric),
  });
  return { clock, metrics, collector };
}

describe('StartupCollector (AC-6)', () => {
  it('emits ttr, cold launch and bundle load once, at first render', () => {
    const { collector, metrics } = setup(
      { processStartTime: 3_000, coldLaunchMs: 650, prewarmed: false },
      { bundleStart: 3_700, bundleEnd: 3_900 },
    );
    collector.onFirstRender();
    collector.onFirstRender();
    expect(metrics).toEqual([
      { name: 'app_startup.ttr', valueMs: 2_000 },
      { name: 'app_startup.cold_launch_time', valueMs: 650 },
      { name: 'app_startup.bundle_load_time', valueMs: 200 },
    ]);
  });

  it('records cold launch later when the native first frame arrives after render', () => {
    const launch: LaunchInfo = { processStartTime: 3_000, prewarmed: false };
    const { collector, metrics } = setup(launch);
    collector.onFirstRender();
    expect(metrics.map((m) => m.name)).toEqual(['app_startup.ttr']);
    launch.coldLaunchMs = 700;
    collector.recordColdLaunch();
    collector.recordColdLaunch();
    expect(metrics.filter((m) => m.name === 'app_startup.cold_launch_time')).toHaveLength(1);
  });

  it('records TTI only on the first markInteractive', () => {
    const { collector, metrics, clock } = setup({ processStartTime: 3_000, prewarmed: false });
    clock.now = 6_000;
    expect(collector.markInteractive({ a: 1 })).toBe(true);
    expect(collector.markInteractive({})).toBe(false);
    expect(metrics).toEqual([{ name: 'app_startup.tti', valueMs: 3_000, params: { a: 1 } }]);
  });

  it('skips launch-relative metrics for prewarmed launches but keeps bundle load', () => {
    const { collector, metrics } = setup(
      { processStartTime: 0, prewarmed: true },
      { bundleStart: 100, bundleEnd: 160 },
    );
    collector.onFirstRender();
    collector.markInteractive({});
    expect(metrics).toEqual([{ name: 'app_startup.bundle_load_time', valueMs: 60 }]);
  });

  it('falls back to the SDK load time without native launch info', () => {
    const { collector, metrics } = setup(null);
    collector.onFirstRender();
    expect(metrics).toEqual([{ name: 'app_startup.ttr', valueMs: 1_000 }]);
  });

  it('emits warm launches each time', () => {
    const { collector, metrics } = setup(null);
    collector.onWarmLaunch(120);
    collector.onWarmLaunch(90);
    expect(metrics.map((m) => m.valueMs)).toEqual([120, 90]);
  });
});
