import { describe, expect, it } from 'vitest';
import { SDK_INFO } from './client';

// The SDK does not depend on @types/node, so fs is loaded untyped in this test only.
const FS_MODULE = 'node:fs';

async function read(path: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ FS_MODULE)) as {
    readFileSync(path: URL, encoding: 'utf8'): string;
  };
  return fs.readFileSync(new URL(path, import.meta.url), 'utf8');
}

async function packageInfo(): Promise<{ name: string; version: string }> {
  return JSON.parse(await read('../../package.json')) as { name: string; version: string };
}

describe('SDK version', () => {
  it('reports the published package name and version in every envelope', async () => {
    const pkg = await packageInfo();
    expect(SDK_INFO).toEqual({ name: pkg.name, version: pkg.version });
  });

  it('keeps the Android library version in sync with package.json', async () => {
    const pkg = await packageInfo();
    const gradle = await read('../../android/build.gradle');
    expect(gradle).toContain(`version = '${pkg.version}'`);
    expect(gradle).toContain(`versionName '${pkg.version}'`);
  });
});
