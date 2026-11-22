import { describe, expect, it } from 'vitest';
import { computeFingerprint, culpritOf, isInAppFrame, normalizeMessage } from './fingerprint';

const frames = [
  { function: 'node_internal', file: 'node_modules/react-native/Renderer.js', line: 1, column: 1 },
  { function: 'computeCartTotal', file: 'src/cart.ts', line: 12, column: 5 },
  { function: 'onPress', file: 'src/checkout.tsx', line: 40, column: 9 },
];

describe('computeFingerprint (AC-18)', () => {
  it('ignores message and line numbers for symbolicated frames', () => {
    const moved = frames.map((frame) => ({ ...frame, line: (frame.line ?? 0) + 10 }));
    expect(computeFingerprint('TypeError', frames, 'user 1')).toBe(
      computeFingerprint('TypeError', moved, 'user 2'),
    );
  });

  it('differs when the top in-app function differs', () => {
    const other = [{ ...frames[1], function: 'applyCoupon' }, frames[2]];
    expect(computeFingerprint('TypeError', frames, 'x')).not.toBe(
      computeFingerprint('TypeError', other as never, 'x'),
    );
  });

  it('differs by error type', () => {
    expect(computeFingerprint('TypeError', frames, 'x')).not.toBe(
      computeFingerprint('RangeError', frames, 'x'),
    );
  });

  it('uses exact bundle positions for unsymbolicated frames', () => {
    const a = [{ function: 'a', file: 'index.android.bundle', line: 1, column: 100 }];
    const b = [{ function: 'a', file: 'index.android.bundle', line: 1, column: 200 }];
    expect(computeFingerprint('Error', a, 'x')).not.toBe(computeFingerprint('Error', b, 'x'));
  });

  it('falls back to the normalized message without frames', () => {
    expect(computeFingerprint('Error', [], 'Order 1234 not found')).toBe(
      computeFingerprint('Error', [], 'Order 99 not found'),
    );
    expect(computeFingerprint('Error', [], 'Order not found')).not.toBe(
      computeFingerprint('Error', [], 'Cart empty'),
    );
  });
});

describe('helpers', () => {
  it('detects in-app frames', () => {
    expect(isInAppFrame(frames[0] as never)).toBe(false);
    expect(isInAppFrame(frames[1] as never)).toBe(true);
    expect(isInAppFrame({ function: 'x', native: true })).toBe(false);
    expect(isInAppFrame({ function: 'x', native: true, inApp: true })).toBe(true);
  });

  it('builds a culprit from the top in-app frame', () => {
    expect(culpritOf(frames as never)).toBe('src/cart.ts:12 in computeCartTotal');
    expect(culpritOf([{ function: 'App + 0x1a', module: 'App', native: true }])).toBe('App + 0x1a');
    expect(culpritOf([])).toBeNull();
  });

  it('normalizes volatile tokens', () => {
    expect(normalizeMessage("User 42 '0b9a3b3e-4c7e-4b0b-9d0c-2f3e1d3a6b7c' at 0xdeadbeef")).toBe(
      'User <n> <str> at <hex>',
    );
  });
});
