import { describe, expect, it } from 'vitest';
import { isSensitiveKey, redactSensitive } from './redact';

describe('redactSensitive', () => {
  it('redacts credential-shaped keys without touching the rest', () => {
    expect(
      redactSensitive({
        password: 'hunter2',
        userToken: 'abc123',
        cardNumber: '4111111111111111',
        items: 3,
        screen: '/checkout',
      }),
    ).toEqual({
      password: '[redacted]',
      userToken: '[redacted]',
      cardNumber: '[redacted]',
      items: 3,
      screen: '/checkout',
    });
  });

  it('matches case-insensitively and common key spellings', () => {
    for (const key of [
      'PASSWORD',
      'api_key',
      'Authorization',
      'oneTimeCode',
      'refresh-token',
      'cvv',
      'Secret',
    ]) {
      expect(isSensitiveKey(key)).toBe(true);
    }
    expect(isSensitiveKey('items')).toBe(false);
    expect(isSensitiveKey('screenName')).toBe(false);
  });

  it('returns an equal-size object for empty input', () => {
    expect(redactSensitive({})).toEqual({});
  });
});
