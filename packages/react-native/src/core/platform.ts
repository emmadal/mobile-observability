import type { NativeAppInfo, NativeBridge } from '../native/types';
import type { StartupTiming } from '../performance/startup';
import type { HttpPost } from '../transport/transport';
import type { ObserveConfig } from '../types';

export interface UpdatesInfo {
  updateId?: string;
  runtimeVersion?: string;
  channel?: string;
  isEmbeddedLaunch?: boolean;
}

export type AppStateStatus = 'active' | 'background' | 'inactive' | string;

/** Everything the client needs from React Native, injected so the core is testable in Node. */
export interface PlatformAdapter {
  native: NativeBridge;
  /** `__DEV__` of the JS bundle. */
  isDevBundle: boolean;
  appState: {
    current(): AppStateStatus;
    subscribe(listener: (state: AppStateStatus) => void): () => void;
  };
  fallbackAppInfo(): NativeAppInfo;
  /** `expo.extra.observability` from app config, so apiKey/endpoint can live in app.json. */
  manifestConfig(): ObserveConfig | null;
  updatesInfo(): UpdatesInfo;
  startupTiming(): StartupTiming | null;
  installErrorHandler(handler: (error: unknown, isFatal: boolean) => void): () => void;
  installRejectionTracker(handler: (reason: unknown) => void): () => void;
  post: HttpPost;
  now(): number;
  nextFrame(callback: () => void): void;
  warn(message: string): void;
  XMLHttpRequest?: typeof XMLHttpRequest;
  /** Object whose `fetch` is wrapped (globalThis in the app). */
  fetchTarget?: { fetch?: typeof fetch };
  /** Origin of the Metro dev server the bundle came from (dev bundles), e.g. http://192.168.1.2:8081. */
  devServerOrigin?(): string | null;
}
