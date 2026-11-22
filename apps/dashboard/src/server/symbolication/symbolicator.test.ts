import { describe, expect, it } from 'vitest';
import { fixtureMap } from '../../../test/sourcemap-fixture';
import { bundleKeysFor, displayPath, loadMap, symbolicateFrame } from './symbolicator';

describe('symbolicateFrame (AC-19)', () => {
  const loaded = loadMap(fixtureMap());

  it('maps a 1-based stack column to the original file, line, function and context', () => {
    const frame = symbolicateFrame(
      { function: 'a', file: 'index.android.bundle', line: 1, column: 101 },
      loaded,
    );
    expect(frame).toMatchObject({
      function: 'computeCartTotal',
      file: 'src/cart.ts',
      line: 12,
      column: 5,
      inApp: true,
      symbolicated: true,
    });
    expect(frame.context?.line).toBe('line 12');
    expect(frame.context?.pre).toHaveLength(5);
    expect(frame.context?.post).toEqual(['line 13', 'line 14', 'line 15', 'line 16', 'line 17']);
  });

  it('resolves the nearest preceding mapping on the same line', () => {
    const frame = symbolicateFrame({ file: 'index.android.bundle', line: 1, column: 520 }, loaded);
    expect(frame).toMatchObject({
      file: 'src/screens/checkout.tsx',
      line: 40,
      function: 'onPress',
    });
  });

  it('marks node_modules frames as not in app', () => {
    const frame = symbolicateFrame({ file: 'main.jsbundle', line: 1, column: 301 }, loaded);
    expect(frame).toMatchObject({ file: 'node_modules/react-native/Renderer.js', inApp: false });
  });

  it('leaves native frames and unmapped positions untouched', () => {
    const native = { function: 'App + 0x1', native: true };
    expect(symbolicateFrame(native, loaded)).toBe(native);
    const before = { file: 'index.android.bundle', line: 1, column: 10 };
    expect(symbolicateFrame(before, loaded)).toBe(before);
  });
});

describe('helpers', () => {
  it('strips the project root and keeps node_modules paths', () => {
    expect(displayPath('/a/b/src/x.ts', '/a/b/')).toBe('src/x.ts');
    expect(displayPath('/a/b/node_modules/lib/i.js', '/a/b/')).toBe('node_modules/lib/i.js');
  });

  it('looks up the OTA update map first, then the build', () => {
    expect(
      bundleKeysFor({ updateId: 'u1', isEmbeddedLaunch: false, version: '1.0', build: '7' }),
    ).toEqual(['update:u1', 'build:1.0+7']);
    expect(bundleKeysFor({ version: '1.0', build: '7' })).toEqual(['build:1.0+7']);
  });
});

describe('context limits', () => {
  it('clips long context lines and splits each source once', async () => {
    const { addMapping, GenMapping, setSourceContent, toEncodedMap } = await import(
      '@jridgewell/gen-mapping'
    );
    const map = new GenMapping();
    setSourceContent(map, '/app/node_modules/x/i.js', '');
    setSourceContent(map, '/app/src/big.ts', `${'a'.repeat(10_000)}\nsecond`);
    addMapping(map, {
      generated: { line: 1, column: 0 },
      source: '/app/src/big.ts',
      original: { line: 1, column: 0 },
    });
    const loaded = loadMap(JSON.stringify(toEncodedMap(map)));
    const frame = symbolicateFrame({ file: 'main.jsbundle', line: 1, column: 1 }, loaded);
    expect(frame.context?.line).toHaveLength(256);
    symbolicateFrame({ file: 'main.jsbundle', line: 1, column: 1 }, loaded);
    expect(loaded.lines.size).toBe(1);
  });
});
