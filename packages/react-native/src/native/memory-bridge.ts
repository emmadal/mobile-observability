import type { NativeBridge } from './types';

/**
 * Stand-in used when the native module is missing (Expo Go, web, tests).
 * JS features keep working; native-only data is simply absent (AC-10).
 */
export function createMemoryBridge(): NativeBridge {
  const storage = new Map<string, string>();
  let installationId: string | null = null;
  return {
    isAvailable: false,
    getLaunchInfo: () => null,
    getAppInfo: () => null,
    getInstallationId: () => installationId,
    getDeviceState: () => ({}),
    getFrameStats: () => null,
    stopFrameTracking: () => {},
    setCrashContext: () => {},
    persistJsFatal: () => {},
    getPendingReports: () => [],
    deletePendingReports: () => {},
    storageGet: (key) => {
      if (key === '__installationId') return installationId;
      return storage.get(key) ?? null;
    },
    storageSet: async (key, value) => {
      if (key === '__installationId') installationId = value;
      else if (value === null) storage.delete(key);
      else storage.set(key, value);
    },
    triggerTestCrash: () => {},
    addWarmLaunchListener: () => ({ remove: () => {} }),
  };
}
