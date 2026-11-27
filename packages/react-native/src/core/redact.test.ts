import { describe, expect, it } from 'vitest';
import { isSensitiveKey, redactSensitive, sanitizeResponseBody } from './redact';

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

describe('PIN keys', () => {
  it('treats pin words as sensitive but not words containing "pin"', () => {
    for (const key of ['pin', 'PIN', 'newPin', 'old_pin', 'pin-code', 'pincode']) {
      expect(isSensitiveKey(key)).toBe(true);
    }
    for (const key of ['shipping', 'mapping', 'spinner', 'pinned']) {
      expect(isSensitiveKey(key)).toBe(false);
    }
  });
});

describe('sanitizeResponseBody', () => {
  it('redacts sensitive keys at every level of a JSON body', () => {
    expect(
      sanitizeResponseBody(
        '{"message":"Locked","user":{"msisdn":"231770000001","password":"x"},"items":[{"apiKey":"k"}]}',
        2048,
      ),
    ).toBe(
      '{"message":"Locked","user":{"msisdn":"231770000001","password":"[redacted]"},"items":[{"apiKey":"[redacted]"}]}',
    );
  });

  it('redacts key/value pairs in text that is not valid JSON, then truncates', () => {
    expect(sanitizeResponseBody('error {"token": "abc", "pin":1234, "code": 7}', 2048)).toBe(
      'error {"token": "[redacted]", "pin":"[redacted]", "code": 7}',
    );
    expect(sanitizeResponseBody('x'.repeat(50), 10)).toBe('x'.repeat(10));
    expect(sanitizeResponseBody('   ', 10)).toBeUndefined();
  });
});
