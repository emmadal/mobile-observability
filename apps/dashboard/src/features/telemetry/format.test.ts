import { describe, expect, it } from 'vitest';
import { deviceLabel, osLabel } from './format';

describe('osLabel', () => {
  it('names the platform with its release', () => {
    expect(osLabel('android', '14')).toBe('Android 14');
    expect(osLabel('android', '12L')).toBe('Android 12L');
    expect(osLabel('ios', '18.1.1')).toBe('iOS 18.1.1');
  });

  it('translates an Android API level into its release', () => {
    expect(osLabel('android', '34')).toBe('Android 14 (API 34)');
    expect(osLabel('android', '30')).toBe('Android 11 (API 30)');
    expect(osLabel('android', '99')).toBe('Android API 99');
  });

  it('does not treat iOS versions as API levels', () => {
    expect(osLabel('ios', '26')).toBe('iOS 26');
  });

  it('says when the version is unknown', () => {
    expect(osLabel('android', null)).toBe('Android, version unknown');
    expect(osLabel('ios', '  ')).toBe('iOS, version unknown');
  });
});

describe('deviceLabel', () => {
  it('joins brand and model, capitalizing lowercase brands', () => {
    expect(deviceLabel('samsung', 'SM-A546E')).toBe('Samsung SM-A546E');
    expect(deviceLabel('Apple', 'iPhone15,2')).toBe('Apple iPhone15,2');
  });

  it('skips the brand when the model already starts with it', () => {
    expect(deviceLabel('TECNO', 'TECNO KI5q')).toBe('TECNO KI5q');
    expect(deviceLabel('Infinix', 'Infinix X6833B')).toBe('Infinix X6833B');
  });

  it('handles a missing brand or model', () => {
    expect(deviceLabel(null, 'Pixel 8')).toBe('Pixel 8');
    expect(deviceLabel('Xiaomi', null)).toBe('Xiaomi');
    expect(deviceLabel(null, null)).toBeNull();
    expect(deviceLabel(' ', '')).toBeNull();
  });
});
