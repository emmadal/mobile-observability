import { describe, expect, it } from 'vitest';
import { parseStack } from './stack-parser';

describe('parseStack', () => {
  it('parses Hermes release frames (bytecode offsets)', () => {
    const stack = [
      "TypeError: Cannot read property 'items' of undefined",
      '    at computeCartTotal (address at index.android.bundle:1:184501)',
      '    at onPress (address at index.android.bundle:1:190022)',
      '    at anonymous (native)',
    ].join('\n');
    expect(parseStack(stack)).toEqual([
      { function: 'computeCartTotal', file: 'index.android.bundle', line: 1, column: 184501 },
      { function: 'onPress', file: 'index.android.bundle', line: 1, column: 190022 },
      { function: 'anonymous', native: true, inApp: false },
    ]);
  });

  it('parses Hermes dev frames and strips the dev server query', () => {
    const stack =
      'Error: boom\n    at handlePress (http://localhost:8081/index.bundle?platform=ios&dev=true:123:45)';
    expect(parseStack(stack)).toEqual([
      {
        function: 'handlePress',
        file: 'http://localhost:8081/index.bundle',
        line: 123,
        column: 45,
      },
    ]);
  });

  it('parses frames without a function name', () => {
    expect(parseStack('Error\n    at main.jsbundle:1:99')).toEqual([
      { function: undefined, file: 'main.jsbundle', line: 1, column: 99 },
    ]);
  });

  it('parses JavaScriptCore frames', () => {
    const stack = 'onPress@main.jsbundle:10:20\n@main.jsbundle:11:5\n[native code]';
    expect(parseStack(stack)).toEqual([
      { function: 'onPress', file: 'main.jsbundle', line: 10, column: 20 },
      { function: undefined, file: 'main.jsbundle', line: 11, column: 5 },
    ]);
  });

  it('returns no frames for empty input and caps at 100 frames', () => {
    expect(parseStack(undefined)).toEqual([]);
    const long = Array.from(
      { length: 150 },
      (_, i) => `    at f${i} (address at main.jsbundle:1:${i})`,
    ).join('\n');
    expect(parseStack(`Error\n${long}`)).toHaveLength(100);
  });
});
