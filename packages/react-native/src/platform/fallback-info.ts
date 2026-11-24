import type { NativeAppInfo } from '../native/types';

/** The subset of React Native's `Platform.constants` the fallback reads; every field is optional. */
export interface PlatformConstantsLike {
  // Android (android.os.Build)
  Release?: unknown;
  Model?: unknown;
  Manufacturer?: unknown;
  Brand?: unknown;
  Fingerprint?: unknown;
  // iOS (UIDevice)
  osVersion?: unknown;
  interfaceIdiom?: unknown;
}

export interface FallbackInput {
  os: string;
  /** `Platform.Version`: the API level (number) on Android, the OS version (string) on iOS. */
  version: unknown;
  constants: PlatformConstantsLike | null;
  locale: string | null;
  appVersion: string | undefined;
  isDebugBuild: boolean;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isAndroidEmulator(fingerprint: string | undefined, model: string | undefined): boolean {
  return (
    (fingerprint?.startsWith('generic') ?? false) ||
    (fingerprint?.includes('emulator') ?? false) ||
    (model?.includes('sdk_gphone') ?? false) ||
    (model?.includes('Emulator') ?? false)
  );
}

const IOS_IDIOM_MODELS: Record<string, string> = { phone: 'iPhone', pad: 'iPad' };

/**
 * App and device info when the native module is missing, for example when an OTA update runs
 * this SDK on a binary built without it. It reads React Native's own platform constants, so
 * the OS release ("14", not API level 34), brand, model and locale still reach the dashboard.
 */
export function fallbackAppInfo(input: FallbackInput): NativeAppInfo {
  const constants = input.constants ?? {};
  const locale = text(input.locale);
  const base = {
    version: input.appVersion ?? '0.0.0',
    build: '0',
    isDebugBuild: input.isDebugBuild,
    ...(locale ? { locale } : {}),
  };

  if (input.os === 'android') {
    const release = text(constants.Release);
    const model = text(constants.Model);
    const manufacturer = text(constants.Manufacturer) ?? text(constants.Brand);
    const fingerprint = text(constants.Fingerprint);
    return {
      ...base,
      platform: 'android',
      osVersion: release ?? String(input.version),
      ...(model ? { model } : {}),
      ...(manufacturer ? { manufacturer } : {}),
      ...(fingerprint || model ? { isEmulator: isAndroidEmulator(fingerprint, model) } : {}),
    };
  }

  const idiom = text(constants.interfaceIdiom);
  const model = idiom ? IOS_IDIOM_MODELS[idiom] : undefined;
  return {
    ...base,
    platform: 'ios',
    osVersion: text(constants.osVersion) ?? String(input.version),
    manufacturer: 'Apple',
    ...(model ? { model } : {}),
  };
}
