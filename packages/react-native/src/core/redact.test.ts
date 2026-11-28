import { describe, expect, it } from 'vitest';
import { isSensitiveKey, redactSensitive, redactUrl, sanitizeResponseBody } from './redact';

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

  it('redacts the same keys in text as in JSON (camelCase, form, XML)', () => {
    expect(
      sanitizeResponseBody('error: {"newPin": "1234", "userId": 7, "oneTimeCode": "99"', 2048),
    ).toBe('error: {"newPin": "[redacted]", "userId": 7, "oneTimeCode": "[redacted]"');
    expect(sanitizeResponseBody('pin=1234&msisdn=231770000001&access_token=abc', 2048)).toBe(
      'pin=[redacted]&msisdn=231770000001&access_token=[redacted]',
    );
    expect(
      sanitizeResponseBody(
        '<error><message>Denied</message><Password>x</Password><apiKey a="1">k</apiKey></error>',
        2048,
      ),
    ).toBe(
      '<error><message>Denied</message><Password>[redacted]</Password><apiKey a="1">[redacted]</apiKey></error>',
    );
    // A JSON body too long to parse still has its keys redacted as text.
    const long = `{"userPin":"4321","pad":"${'x'.repeat(70_000)}"}`;
    expect(sanitizeResponseBody(long, 40)).toBe('{"userPin":"[redacted]","pad":"xxxxxxxxx');
  });

  it('redacts a sensitive value cut by the scan limit through to the end', () => {
    const secret = 'hunter2 '.repeat(40);
    const quoted = sanitizeResponseBody(`error {"token": "${secret}"}`, 30);
    expect(quoted).toBe('error {"token": "[redacted]"');
    expect(quoted).not.toContain('hunter2');
    const xml = sanitizeResponseBody(`<error><password>${secret}</password></error>`, 40);
    expect(xml).toBe('<error><password>[redacted]</password>');
    expect(xml).not.toContain('hunter2');
  });

  it('redacts key/value pairs in text that is not valid JSON, then truncates', () => {
    expect(sanitizeResponseBody('error {"token": "abc", "pin":1234, "code": 7}', 2048)).toBe(
      'error {"token": "[redacted]", "pin":"[redacted]", "code": 7}',
    );
    expect(sanitizeResponseBody('x'.repeat(50), 10)).toBe('x'.repeat(10));
    expect(sanitizeResponseBody('   ', 10)).toBeUndefined();
  });
});

describe('redactUrl', () => {
  it('keeps the URL as called but drops user info, fragment and credential values', () => {
    expect(
      redactUrl(
        'https://me:secret@api.example.com/kya/agents/231770000001?msisdn=231770000001&OTP=1234&access%5Ftoken=t&flag#frag',
        2048,
      ),
    ).toBe(
      'https://api.example.com/kya/agents/231770000001?msisdn=231770000001&OTP=[redacted]&access%5Ftoken=[redacted]&flag',
    );
  });

  it('leaves URLs without a query alone and cuts long ones', () => {
    expect(redactUrl('https://api.example.com/a/b', 2048)).toBe('https://api.example.com/a/b');
    expect(redactUrl(`https://api.example.com/?q=${'x'.repeat(100)}`, 30)).toHaveLength(30);
  });
});

describe('sanitizeResponseBody on large bodies', () => {
  it('scans only a bounded window of a body too long to parse', () => {
    const huge = `{"token":"abc","rows":[${'1,'.repeat(100_000)}1]}`;
    const body = sanitizeResponseBody(huge, 100);
    expect(body).toHaveLength(100);
    expect(body).toContain('"token":"[redacted]"');
  });
});

describe('redaction of values that are objects or arrays, in text too long to parse', () => {
  const padding = `"rows":[${'{"id":1},'.repeat(9_000)}{"id":1}]`;

  it('drops the whole value of a sensitive key', () => {
    const body = `{"card":{"number":"4111111111111111","holder":"A"},"credentials":["s3cr3t"],"name":"ok",${padding}}`;
    expect(body.length).toBeGreaterThan(64 * 1024);
    const sanitized = sanitizeResponseBody(body, 4096) ?? '';
    expect(sanitized).not.toContain('4111111111111111');
    expect(sanitized).not.toContain('s3cr3t');
    expect(sanitized).toContain('"card":"[redacted]"');
    expect(sanitized).toContain('"credentials":"[redacted]"');
    expect(sanitized).toContain('"name":"ok"');
  });

  it('drops a sensitive value cut by the scan window through to its end', () => {
    const body = `{${padding},"token":{"value":"${'z'.repeat(20_000)}"}}`;
    const head = sanitizeResponseBody(`{"token":{"value":"abc", "more": ${'['.repeat(10)}`, 4096);
    expect(head).toBe('{"token":"[redacted]"');
    expect(sanitizeResponseBody(body, 4096)).not.toContain('zzz');
  });

  it('ignores brackets inside strings when finding the end of the value', () => {
    const body = `{"secret":{"note":"a } ] tricky \\" quote"},"visible":"yes",${padding}}`;
    const sanitized = sanitizeResponseBody(body, 4096) ?? '';
    expect(sanitized.startsWith('{"secret":"[redacted]","visible":"yes"')).toBe(true);
  });
});

describe('redactUrl separators', () => {
  it('reads pairs as servers do: split on & only, a value may contain ;', () => {
    expect(redactUrl('https://api.example.com/a?token=abc;def&lang=en', 2048)).toBe(
      'https://api.example.com/a?token=[redacted]&lang=en',
    );
  });

  it('redacts from a sensitive key that follows ; to the end of its pair', () => {
    expect(redactUrl('https://api.example.com/a?lang=en;token=abc;x=1&pin=1;x=2&q=ok', 2048)).toBe(
      'https://api.example.com/a?lang=en;token=[redacted]&pin=[redacted]&q=ok',
    );
  });
});
