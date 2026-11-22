import type { EnvelopeInput } from '@mobile-observability/protocol';
import { gunzipSync, strFromU8 } from 'fflate';
import type { PlatformAdapter } from '../core/platform';
import { createMemoryBridge } from '../native/memory-bridge';
import type { LaunchInfo, NativeBridge } from '../native/types';

export interface FakePlatform extends PlatformAdapter {
  clock: { now: number };
  sent: EnvelopeInput[];
  responses: number[];
  appStateListeners: ((state: string) => void)[];
  errorHandler: ((error: unknown, isFatal: boolean) => void) | null;
  rejectionHandler: ((reason: unknown) => void) | null;
  frames: (() => void)[];
  warnings: string[];
  runFrames(): void;
}

export function decodeBody(body: Uint8Array): EnvelopeInput {
  return JSON.parse(strFromU8(gunzipSync(body))) as EnvelopeInput;
}

export function createFakePlatform(
  overrides: Partial<PlatformAdapter> & { native?: NativeBridge } = {},
): FakePlatform {
  const clock = { now: 1_763_800_000_000 };
  const platform: FakePlatform = {
    clock,
    sent: [],
    responses: [],
    appStateListeners: [],
    errorHandler: null,
    rejectionHandler: null,
    frames: [],
    warnings: [],
    native: createMemoryBridge(),
    isDevBundle: false,
    appState: {
      current: () => 'active',
      subscribe: (listener) => {
        platform.appStateListeners.push(listener);
        return () => undefined;
      },
    },
    fallbackAppInfo: () => ({
      platform: 'ios',
      version: '1.0.0',
      build: '7',
      osVersion: '26.1',
      isDebugBuild: false,
    }),
    manifestConfig: () => null,
    updatesInfo: () => ({ updateId: 'update-1', runtimeVersion: '1.0.0', channel: 'production' }),
    startupTiming: () => null,
    installErrorHandler: (handler) => {
      platform.errorHandler = handler;
      return () => {
        platform.errorHandler = null;
      };
    },
    installRejectionTracker: (handler) => {
      platform.rejectionHandler = handler;
      return () => {
        platform.rejectionHandler = null;
      };
    },
    post: async (_url, init) => {
      platform.sent.push(decodeBody(init.body));
      const status = platform.responses.shift() ?? 202;
      return { status, headers: { get: () => null } };
    },
    now: () => clock.now,
    nextFrame: (callback) => {
      platform.frames.push(callback);
    },
    warn: (message) => {
      platform.warnings.push(message);
    },
    runFrames: () => {
      const frames = platform.frames.splice(0);
      for (const frame of frames) frame();
    },
    ...overrides,
  };
  return platform;
}

/** Memory bridge that pretends to be native, with launch info and storage. */
export function createNativeLikeBridge(
  launch: LaunchInfo | null,
  extra: Partial<NativeBridge> = {},
): NativeBridge {
  const base = createMemoryBridge();
  return {
    ...base,
    isAvailable: true,
    getLaunchInfo: () => launch,
    getInstallationId: () => 'install-abc',
    getAppInfo: () => ({
      platform: 'ios',
      version: '2.0.0',
      build: '20',
      osVersion: '26.1',
      model: 'iPhone18,1',
      isDebugBuild: false,
    }),
    ...extra,
  };
}

export const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
