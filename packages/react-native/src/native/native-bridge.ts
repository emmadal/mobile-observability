import { requireOptionalNativeModule } from 'expo';
import { createMemoryBridge } from './memory-bridge';
import type {
  DeviceStateSnapshot,
  FrameStats,
  LaunchInfo,
  NativeAppInfo,
  NativeBridge,
  Subscription,
} from './types';

interface RawNativeModule {
  getLaunchInfo(): LaunchInfo;
  getAppInfo(): NativeAppInfo;
  getInstallationId(): string;
  getDeviceState(): DeviceStateSnapshot;
  getFrameStats(): FrameStats;
  stopFrameTracking(): void;
  setCrashContext(json: string): void;
  persistJsFatal(json: string): void;
  getPendingReports(): string[];
  deletePendingReports(ids: string[]): void;
  storageGet(key: string): string | null;
  storageSet(key: string, value: string | null): Promise<void>;
  triggerTestCrash(kind: string): void;
  addListener(
    event: 'onWarmLaunch',
    listener: (event: { durationMs: number }) => void,
  ): Subscription;
}

/** Wraps the native module; every call is guarded so a native failure never crashes the app. */
export function createNativeBridge(): NativeBridge {
  const module = requireOptionalNativeModule<RawNativeModule>('MobileObservability');
  if (!module) return createMemoryBridge();

  const safe = <T>(call: () => T, fallback: T): T => {
    try {
      return call();
    } catch {
      return fallback;
    }
  };

  return {
    isAvailable: true,
    getLaunchInfo: () => safe(() => module.getLaunchInfo(), null),
    getAppInfo: () => safe(() => module.getAppInfo(), null),
    getInstallationId: () => safe(() => module.getInstallationId(), null),
    getDeviceState: () => safe(() => module.getDeviceState(), {}),
    getFrameStats: () => safe(() => module.getFrameStats(), null),
    stopFrameTracking: () => safe(() => module.stopFrameTracking(), undefined),
    setCrashContext: (json) => safe(() => module.setCrashContext(json), undefined),
    persistJsFatal: (json) => safe(() => module.persistJsFatal(json), undefined),
    getPendingReports: () => safe(() => module.getPendingReports(), []),
    deletePendingReports: (ids) => safe(() => module.deletePendingReports(ids), undefined),
    storageGet: (key) => safe(() => module.storageGet(key), null),
    storageSet: async (key, value) => {
      try {
        await module.storageSet(key, value);
      } catch {
        // Persistence is best effort; the in-memory queue still holds the data.
      }
    },
    triggerTestCrash: (kind) => module.triggerTestCrash(kind),
    addWarmLaunchListener: (listener) =>
      safe(() => module.addListener('onWarmLaunch', (event) => listener(event.durationMs)), {
        remove: () => {},
      }),
  };
}
