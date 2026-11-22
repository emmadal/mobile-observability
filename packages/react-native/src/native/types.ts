export interface LaunchInfo {
  /** Epoch ms when the OS started the process. */
  processStartTime: number;
  /** Process start until the first native frame; absent until drawn or when prewarmed. */
  coldLaunchMs?: number;
  /** iOS prewarm or Android background start: cold launch is not meaningful. */
  prewarmed: boolean;
}

export interface NativeAppInfo {
  platform: 'ios' | 'android';
  version: string;
  build: string;
  bundleId?: string;
  osVersion: string;
  manufacturer?: string;
  model?: string;
  locale?: string;
  isEmulator?: boolean;
  isDebugBuild: boolean;
}

export interface DeviceStateSnapshot {
  lowPowerMode?: boolean;
  thermalState?: string;
  batteryLevel?: number;
  batteryCharging?: boolean;
  networkConnected?: boolean;
  networkType?: string;
  networkExpensive?: boolean;
  networkConstrained?: boolean;
  dataSaverEnabled?: boolean;
}

export interface FrameStats {
  slowFrames: number;
  frozenFrames: number;
  totalDelayMs: number;
}

export interface Subscription {
  remove(): void;
}

/** Contract of the Swift/Kotlin `MobileObservability` module. */
export interface NativeBridge {
  readonly isAvailable: boolean;
  getLaunchInfo(): LaunchInfo | null;
  getAppInfo(): NativeAppInfo | null;
  getInstallationId(): string | null;
  getDeviceState(): DeviceStateSnapshot;
  getFrameStats(): FrameStats | null;
  stopFrameTracking(): void;
  setCrashContext(json: string): void;
  persistJsFatal(json: string): void;
  getPendingReports(): string[];
  deletePendingReports(ids: string[]): void;
  storageGet(key: string): string | null;
  storageSet(key: string, value: string | null): Promise<void>;
  triggerTestCrash(kind: 'signal' | 'exception'): void;
  addWarmLaunchListener(listener: (durationMs: number) => void): Subscription;
}
