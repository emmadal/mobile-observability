import { describe, expect, it } from 'vitest';
import { normalizeError } from './normalize';

describe('normalizeError', () => {
  it('uses the error name as type', () => {
    const result = normalizeError(new TypeError('bad'));
    expect(result.type).toBe('TypeError');
    expect(result.message).toBe('bad');
  });

  it('uses the subclass name for plain Error subclasses', () => {
    class PaymentError extends Error {}
    expect(normalizeError(new PaymentError('declined')).type).toBe('PaymentError');
  });

  it('handles thrown strings and objects', () => {
    expect(normalizeError('oops')).toEqual({ type: 'NonErrorThrown', message: 'oops', frames: [] });
    expect(normalizeError({ code: 42 }).message).toBe('{"code":42}');
    expect(normalizeError({ name: 'ApiError', message: 'x' }).type).toBe('ApiError');
  });
});
