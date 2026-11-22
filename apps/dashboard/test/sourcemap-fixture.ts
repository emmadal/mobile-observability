import { addMapping, GenMapping, setSourceContent, toEncodedMap } from '@jridgewell/gen-mapping';

const SOURCE = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');

/** A map where bundle line 1 column 100 points at /app/src/cart.ts:12:4 (name computeCartTotal). */
export function fixtureMap(): string {
  const map = new GenMapping({ file: 'index.android.bundle' });
  setSourceContent(map, '/Users/dev/app/src/cart.ts', SOURCE);
  addMapping(map, {
    generated: { line: 1, column: 100 },
    source: '/Users/dev/app/src/cart.ts',
    original: { line: 12, column: 4 },
    name: 'computeCartTotal',
  });
  addMapping(map, {
    generated: { line: 1, column: 300 },
    source: '/Users/dev/app/node_modules/react-native/Renderer.js',
    original: { line: 5, column: 0 },
  });
  addMapping(map, {
    generated: { line: 1, column: 500 },
    source: '/Users/dev/app/src/screens/checkout.tsx',
    original: { line: 40, column: 2 },
    name: 'onPress',
  });
  return JSON.stringify(toEncodedMap(map));
}
