import { AppState, Platform } from 'react-native';
import type { PlatformAdapter, UpdatesInfo } from '../core/platform';
import { createNativeBridge } from '../native/native-bridge';
import type { NativeAppInfo } from '../native/types';
import type { StartupTiming } from '../performance/startup';
import type { ObserveConfig } from '../types';
import {
  fallbackAppInfo as buildFallbackAppInfo,
  type PlatformConstantsLike,
} from './fallback-info';

interface ErrorUtilsLike {
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
}

interface HermesInternalLike {
  enablePromiseRejectionTracker?: (options: {
    allRejections: boolean;
    onUnhandled: (id: number, reason: unknown) => void;
    onHandled: (id: number) => void;
  }) => void;
}

interface RnStartupTiming {
  startTime?: number | null;
  executeJavaScriptBundleEntryPointStart?: number | null;
  endTime?: number | null;
}

type GlobalWithRuntime = typeof globalThis & {
  ErrorUtils?: ErrorUtilsLike;
  HermesInternal?: HermesInternalLike;
  performance?: { now(): number; timeOrigin?: number; rnStartupTiming?: RnStartupTiming };
};

const runtime = globalThis as GlobalWithRuntime;

function safely<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

type UpdatesModule = {
  updateId?: string | null;
  runtimeVersion?: string | null;
  channel?: string | null;
  isEmbeddedLaunch?: boolean;
};

type ConstantsModule = {
  default?: { expoConfig?: { version?: string; extra?: { observability?: ObserveConfig } } };
};

// Optional peers. Metro only treats a require as optional when it sits directly in a try block.
let updatesModule: UpdatesModule | null = null;
try {
  updatesModule = require('expo-updates') as UpdatesModule;
} catch {
  updatesModule = null;
}

let constantsModule: ConstantsModule | null = null;
try {
  constantsModule = require('expo-constants') as ConstantsModule;
} catch {
  constantsModule = null;
}

type RejectionOptions = {
  onUnhandled?: (id: number, reason: unknown) => void;
  onHandled?: (id: number) => void;
};

let devRejectionOptions: RejectionOptions | null = null;
if (__DEV__) {
  try {
    // Dev only and optional: keeps LogBox rejection warnings working while we track rejections.
    // biome-ignore lint/suspicious/noReactNativeDeepImports: no public API exposes these options.
    const tracking = require('react-native/Libraries/promiseRejectionTrackingOptions') as {
      default?: RejectionOptions;
    };
    devRejectionOptions = tracking.default ?? null;
  } catch {
    devRejectionOptions = null;
  }
}

function readUpdatesInfo(): UpdatesInfo {
  const updates = updatesModule;
  if (!updates) return {};
  return {
    ...(updates.updateId ? { updateId: updates.updateId } : {}),
    ...(updates.runtimeVersion ? { runtimeVersion: updates.runtimeVersion } : {}),
    ...(updates.channel ? { channel: updates.channel } : {}),
    ...(typeof updates.isEmbeddedLaunch === 'boolean'
      ? { isEmbeddedLaunch: updates.isEmbeddedLaunch }
      : {}),
  };
}

function readManifestConfig(): ObserveConfig | null {
  return constantsModule?.default?.expoConfig?.extra?.observability ?? null;
}

function readStartupTiming(): StartupTiming | null {
  const performance = runtime.performance;
  const timing = safely(() => performance?.rnStartupTiming);
  if (!performance || !timing) return null;
  // rnStartupTiming is relative to performance.now(); convert to epoch ms.
  const origin = Date.now() - performance.now();
  const toEpoch = (value: number | null | undefined) =>
    typeof value === 'number' && value > 0 ? origin + value : undefined;
  const result: StartupTiming = {};
  const bundleStart = toEpoch(timing.executeJavaScriptBundleEntryPointStart);
  const bundleEnd = toEpoch(timing.endTime);
  const appStart = toEpoch(timing.startTime);
  if (bundleStart !== undefined) result.bundleStart = bundleStart;
  if (bundleEnd !== undefined) result.bundleEnd = bundleEnd;
  if (appStart !== undefined) result.appStart = appStart;
  return result;
}

function readLocale(): string | null {
  return safely(() => Intl.DateTimeFormat().resolvedOptions().locale) ?? null;
}

function fallbackAppInfo(): NativeAppInfo {
  return buildFallbackAppInfo({
    os: Platform.OS,
    version: Platform.Version,
    constants: safely(() => Platform.constants as PlatformConstantsLike),
    locale: readLocale(),
    appVersion: constantsModule?.default?.expoConfig?.version,
    isDebugBuild: __DEV__,
  });
}

export function createReactNativePlatform(): PlatformAdapter {
  return {
    native: createNativeBridge(),
    isDevBundle: __DEV__,
    appState: {
      current: () => AppState.currentState ?? 'active',
      subscribe: (listener) => {
        const subscription = AppState.addEventListener('change', listener);
        return () => subscription.remove();
      },
    },
    fallbackAppInfo,
    manifestConfig: readManifestConfig,
    updatesInfo: readUpdatesInfo,
    startupTiming: readStartupTiming,
    installErrorHandler: (handler) => {
      const errorUtils = runtime.ErrorUtils;
      if (!errorUtils) return () => {};
      const previous = errorUtils.getGlobalHandler();
      errorUtils.setGlobalHandler((error, isFatal) => {
        try {
          handler(error, Boolean(isFatal));
        } finally {
          previous(error, isFatal);
        }
      });
      return () => errorUtils.setGlobalHandler(previous);
    },
    installRejectionTracker: (handler) => {
      const hermes = runtime.HermesInternal;
      if (!hermes?.enablePromiseRejectionTracker) return () => {};
      // In development React Native's LogBox owns rejection tracking; chain to it.
      const devOptions = devRejectionOptions;
      hermes.enablePromiseRejectionTracker({
        allRejections: true,
        onUnhandled: (id, reason) => {
          handler(reason);
          devOptions?.onUnhandled?.(id, reason);
        },
        onHandled: (id) => devOptions?.onHandled?.(id),
      });
      return () => {};
    },
    post: async (url, init) => {
      const response = await fetch(url, init as RequestInit);
      return { status: response.status, headers: response.headers };
    },
    now: () => Date.now(),
    nextFrame: (callback) => requestAnimationFrame(() => callback()),
    warn: (message) => console.warn(message),
    XMLHttpRequest: runtime.XMLHttpRequest,
    fetchTarget: globalThis,
  };
}
