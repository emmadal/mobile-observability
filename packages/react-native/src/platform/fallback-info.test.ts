import { describe, expect, it } from 'vitest';
import { fallbackAppInfo } from './fallback-info';

const base = { locale: 'fr-CI', appVersion: '1.0.0', isDebugBuild: false };

describe('fallbackAppInfo', () => {
  it('reports the Android release, brand, model and locale instead of the API level', () => {
    const info = fallbackAppInfo({
      ...base,
      os: 'android',
      version: 34,
      constants: {
        Release: '14',
        Model: 'SM-A546E',
        Manufacturer: 'samsung',
        Brand: 'samsung',
        Fingerprint: 'samsung/a54xnsxx/a54x:14/UP1A.231005.007/A546EXXS8CXI1:user/release-keys',
      },
    });
    expect(info).toEqual({
      platform: 'android',
      version: '1.0.0',
      build: '0',
      isDebugBuild: false,
      osVersion: '14',
      model: 'SM-A546E',
      manufacturer: 'samsung',
      locale: 'fr-CI',
      isEmulator: false,
    });
  });

  it('flags Android emulators from the build fingerprint or model', () => {
    const emulator = fallbackAppInfo({
      ...base,
      os: 'android',
      version: 35,
      constants: {
        Release: '15',
        Model: 'sdk_gphone64_arm64',
        Manufacturer: 'Google',
        Fingerprint:
          'google/sdk_gphone64_arm64/emu64a:15/AE3A.240806.005/12228598:user/release-keys',
      },
    });
    expect(emulator.isEmulator).toBe(true);
  });

  it('falls back to the brand, then to the API level, when constants are missing', () => {
    const partial = fallbackAppInfo({
      ...base,
      os: 'android',
      version: 33,
      constants: { Brand: 'TECNO', Release: '  ' },
    });
    expect(partial.osVersion).toBe('33');
    expect(partial.manufacturer).toBe('TECNO');
    expect(partial).not.toHaveProperty('isEmulator');

    const none = fallbackAppInfo({ ...base, os: 'android', version: 30, constants: null });
    expect(none.osVersion).toBe('30');
    expect(none).not.toHaveProperty('model');
  });

  it('reports the iOS version, Apple and the device family', () => {
    const info = fallbackAppInfo({
      ...base,
      os: 'ios',
      version: '18.1',
      constants: { osVersion: '18.1.1', interfaceIdiom: 'pad' },
    });
    expect(info).toMatchObject({
      platform: 'ios',
      osVersion: '18.1.1',
      manufacturer: 'Apple',
      model: 'iPad',
      locale: 'fr-CI',
    });
  });

  it('omits the locale and app version when they are unknown', () => {
    const info = fallbackAppInfo({
      os: 'ios',
      version: '17.4',
      constants: {},
      locale: null,
      appVersion: undefined,
      isDebugBuild: true,
    });
    expect(info.version).toBe('0.0.0');
    expect(info.osVersion).toBe('17.4');
    expect(info).not.toHaveProperty('locale');
    expect(info).not.toHaveProperty('model');
  });
});
