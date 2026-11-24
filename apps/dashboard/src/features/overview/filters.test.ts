import { describe, expect, it } from 'vitest';
import {
  bucketStarts,
  parseDay,
  parseOverviewFilters,
  pickBucketSeconds,
  resolveWindow,
  toSearchParams,
} from './filters';

const NOW = new Date('2026-11-24T10:17:30.000Z');
const HOUR = 3_600_000;

describe('parseOverviewFilters', () => {
  it('defaults to the last 24 hours, no refresh, no dimension filters', () => {
    expect(parseOverviewFilters({}, NOW)).toEqual({
      range: { kind: 'quick', key: '24h' },
      refresh: 'off',
      project: null,
      platform: null,
      environment: null,
      version: null,
    });
  });

  it('reads every filter from the URL', () => {
    const filters = parseOverviewFilters(
      {
        range: '3h',
        refresh: '5m',
        project: 'p1',
        platform: 'android',
        env: 'production',
        version: '1.4.0',
      },
      NOW,
    );
    expect(filters).toEqual({
      range: { kind: 'quick', key: '3h' },
      refresh: '5m',
      project: 'p1',
      platform: 'android',
      environment: 'production',
      version: '1.4.0',
    });
  });

  it('falls back to defaults for unknown values', () => {
    const filters = parseOverviewFilters({ range: '2y', refresh: '1s', platform: 'web' }, NOW);
    expect(filters.range).toEqual({ kind: 'quick', key: '24h' });
    expect(filters.refresh).toBe('off');
    expect(filters.platform).toBeNull();
  });

  it('accepts a custom range of UTC days, the quick range winning when both are set', () => {
    expect(parseOverviewFilters({ from: '2026-11-20', to: '2026-11-24' }, NOW).range).toEqual({
      kind: 'custom',
      fromDay: '2026-11-20',
      toDay: '2026-11-24',
    });
    expect(
      parseOverviewFilters({ range: '1h', from: '2026-11-20', to: '2026-11-24' }, NOW).range,
    ).toEqual({ kind: 'quick', key: '1h' });
  });

  it('rejects inverted, future and impossible custom days', () => {
    for (const params of [
      { from: '2026-11-24', to: '2026-11-20' },
      { from: '2026-11-20', to: '2026-11-25' },
      { from: '2026-02-30', to: '2026-03-02' },
      { from: '2026-11-20' },
    ]) {
      expect(parseOverviewFilters(params, NOW).range).toEqual({ kind: 'quick', key: '24h' });
    }
  });

  it('clamps a custom range to the last 90 days', () => {
    expect(parseOverviewFilters({ from: '2025-01-01', to: '2026-11-01' }, NOW).range).toEqual({
      kind: 'custom',
      fromDay: '2026-08-26',
      toDay: '2026-11-01',
    });
  });

  it('ignores oversized values', () => {
    expect(parseOverviewFilters({ version: 'x'.repeat(500) }, NOW).version).toBeNull();
  });
});

describe('resolveWindow', () => {
  it('ends a quick range now', () => {
    const window = resolveWindow({ kind: 'quick', key: '6h' }, NOW);
    expect(window.to).toEqual(NOW);
    expect(NOW.getTime() - window.from.getTime()).toBe(6 * HOUR);
    expect(window.bucketSeconds).toBe(600);
  });

  it('covers whole UTC days for a custom range, stopping at now for today', () => {
    const past = resolveWindow({ kind: 'custom', fromDay: '2026-11-01', toDay: '2026-11-07' }, NOW);
    expect(past.from.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(past.to.toISOString()).toBe('2026-11-08T00:00:00.000Z');
    expect(past.bucketSeconds).toBe(3 * 3600);

    const today = resolveWindow(
      { kind: 'custom', fromDay: '2026-11-24', toDay: '2026-11-24' },
      NOW,
    );
    expect(today.to).toEqual(NOW);
  });
});

describe('pickBucketSeconds', () => {
  it('keeps every quick range at or under 60 buckets', () => {
    expect(pickBucketSeconds(5 * 60_000)).toBe(10);
    expect(pickBucketSeconds(HOUR)).toBe(60);
    expect(pickBucketSeconds(24 * HOUR)).toBe(1800);
    expect(pickBucketSeconds(30 * 24 * HOUR)).toBe(43_200);
    expect(pickBucketSeconds(90 * 24 * HOUR)).toBe(86_400);
  });
});

describe('bucketStarts', () => {
  it('aligns buckets to the epoch and covers the window', () => {
    const window = resolveWindow({ kind: 'quick', key: '1h' }, NOW);
    const starts = bucketStarts(window);
    expect(starts[0]?.toISOString()).toBe('2026-11-24T09:17:00.000Z');
    expect(starts.at(-1)?.toISOString()).toBe('2026-11-24T10:17:00.000Z');
    expect(starts.length).toBe(61);
  });
});

describe('toSearchParams', () => {
  it('round-trips through the parser and leaves defaults out', () => {
    const filters = parseOverviewFilters(
      { from: '2026-11-01', to: '2026-11-07', platform: 'ios', refresh: '1h' },
      NOW,
    );
    const query = toSearchParams(filters);
    expect(query.toString()).toBe('from=2026-11-01&to=2026-11-07&platform=ios&refresh=1h');
    expect(parseOverviewFilters(Object.fromEntries(query), NOW)).toEqual(filters);
    expect(toSearchParams(parseOverviewFilters({}, NOW)).toString()).toBe('');
  });
});

describe('parseDay', () => {
  it('parses valid days only', () => {
    expect(parseDay('2026-11-24')?.toISOString()).toBe('2026-11-24T00:00:00.000Z');
    expect(parseDay('2026-13-01')).toBeNull();
    expect(parseDay('24/11/2026')).toBeNull();
  });
});
