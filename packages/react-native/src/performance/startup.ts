import type { StartupMetricName } from '@mobile-observability/protocol';
import type { LaunchInfo } from '../native/types';
import type { JsonObject } from '../types';

export interface StartupTiming {
  /** Epoch ms when React Native started evaluating the bundle. */
  bundleStart?: number;
  /** Epoch ms when evaluation finished. */
  bundleEnd?: number;
  /** Epoch ms of React Native's own startup marker, a fallback for process start. */
  appStart?: number;
}

export interface StartupMetric {
  name: StartupMetricName;
  valueMs: number;
  params?: JsonObject;
}

export interface StartupCollectorOptions {
  now: () => number;
  launchInfo: () => LaunchInfo | null;
  startupTiming: () => StartupTiming | null;
  sdkLoadedAt: number;
  onMetric: (metric: StartupMetric) => void;
}

/**
 * Emits the five startup metrics (AC-6), each at most once per process:
 * cold launch, bundle load and TTR at the first root layout, TTI on the first
 * `markInteractive()`, and warm launch whenever the native layer reports one.
 */
export class StartupCollector {
  private ttrRecorded = false;
  private ttiRecorded = false;
  private coldRecorded = false;
  private bundleRecorded = false;

  constructor(private readonly options: StartupCollectorOptions) {}

  /** Start of the launch: OS process start, else React Native's marker, else SDK load. */
  launchStart(): number {
    return (
      this.options.launchInfo()?.processStartTime ??
      this.options.startupTiming()?.appStart ??
      this.options.sdkLoadedAt
    );
  }

  /** iOS prewarm / Android background start make launch-relative durations meaningless. */
  private get launchIsMeasurable(): boolean {
    return !(this.options.launchInfo()?.prewarmed ?? false);
  }

  get isInteractiveRecorded(): boolean {
    return this.ttiRecorded;
  }

  /** Call on the next frame after the root view first lays out. */
  onFirstRender(): void {
    if (this.ttrRecorded) return;
    this.ttrRecorded = true;
    const now = this.options.now();
    if (this.launchIsMeasurable) {
      this.emit('app_startup.ttr', now - this.launchStart());
    }
    this.recordColdLaunch();
    this.recordBundleLoad();
  }

  /** Native first-frame time may land after the first render; call again later to catch it. */
  recordColdLaunch(): void {
    if (this.coldRecorded) return;
    const info = this.options.launchInfo();
    if (!info || info.prewarmed || info.coldLaunchMs === undefined) return;
    this.coldRecorded = true;
    this.emit('app_startup.cold_launch_time', info.coldLaunchMs);
  }

  private recordBundleLoad(): void {
    if (this.bundleRecorded) return;
    const timing = this.options.startupTiming();
    if (timing?.bundleStart === undefined || timing.bundleEnd === undefined) return;
    this.bundleRecorded = true;
    this.emit('app_startup.bundle_load_time', timing.bundleEnd - timing.bundleStart);
  }

  /** Returns true when this call recorded the app-level TTI. */
  markInteractive(params: JsonObject): boolean {
    if (this.ttiRecorded) return false;
    this.ttiRecorded = true;
    if (!this.launchIsMeasurable) return false;
    this.emit('app_startup.tti', this.options.now() - this.launchStart(), params);
    return true;
  }

  onWarmLaunch(durationMs: number): void {
    this.emit('app_startup.warm_launch_time', durationMs);
  }

  private emit(name: StartupMetricName, valueMs: number, params?: JsonObject): void {
    if (!Number.isFinite(valueMs) || valueMs < 0) return;
    this.options.onMetric({ name, valueMs, ...(params ? { params } : {}) });
  }
}
