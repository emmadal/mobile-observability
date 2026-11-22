import { describe, expect, it } from 'vitest';
import { TtlCache } from './key-cache';

describe('TtlCache', () => {
  it('expires entries', () => {
    const clock = { now: 0 };
    const cache = new TtlCache<string, number>(10, () => clock.now);
    cache.set('a', 1, 100);
    clock.now = 99;
    expect(cache.get('a')).toBe(1);
    clock.now = 100;
    expect(cache.get('a')).toBeUndefined();
  });

  it('evicts the least recently used entry', () => {
    const cache = new TtlCache<string, number>(2);
    cache.set('a', 1, 1_000);
    cache.set('b', 2, 1_000);
    cache.get('a');
    cache.set('c', 3, 1_000);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });
});
