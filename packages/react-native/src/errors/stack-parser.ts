import type { FrameInput } from '@mobile-observability/protocol';

// Hermes / V8: "    at fn (file:line:col)", "    at fn (address at file:line:offset)", "    at file:line:col"
const HERMES_V8 = /^\s*at (?:(.+?) \()?(address at )?(.+?):(\d+):(\d+)\)?\s*$/;
// Hermes native frames: "    at fn (native)" or "    at [native code]"
const HERMES_NATIVE = /^\s*at (.+?) \((?:native|\[native code\])\)\s*$/;
// JavaScriptCore: "fn@file:line:col"
const JSC = /^\s*(?:(.*?)@)?(.+?):(\d+):(\d+)\s*$/;

const MAX_FRAMES = 100;

function stripQuery(file: string): string {
  // Dev server URLs carry platform/dev flags as query parameters.
  return file.replace(/\?.*$/, '');
}

function normalizeFunction(name: string | undefined): string | undefined {
  if (!name || name === 'anonymous' || name === '?' || name === 'global code')
    return name || undefined;
  return name;
}

/** Parses an Error.stack string from Hermes, V8 or JavaScriptCore into frames, top first. */
export function parseStack(stack: string | undefined | null): FrameInput[] {
  if (!stack) return [];
  const frames: FrameInput[] = [];
  for (const line of stack.split('\n')) {
    if (frames.length >= MAX_FRAMES) break;
    const trimmed = line.trim();
    if (!trimmed) continue;

    const native = HERMES_NATIVE.exec(trimmed);
    if (native) {
      frames.push({ function: normalizeFunction(native[1]), native: true, inApp: false });
      continue;
    }
    if (trimmed.startsWith('at ')) {
      const match = HERMES_V8.exec(trimmed);
      if (match) {
        // Hermes bytecode offsets ("address at") are 0-based while source columns
        // are 1-based; normalize to 1-based so the server always subtracts one.
        const isBytecode = match[2] !== undefined;
        frames.push({
          function: normalizeFunction(match[1]),
          file: stripQuery(match[3] ?? ''),
          line: Number(match[4]),
          column: Number(match[5]) + (isBytecode ? 1 : 0),
        });
      }
      continue;
    }
    const jsc = JSC.exec(trimmed);
    if (jsc && /\d+:\d+$/.test(trimmed)) {
      frames.push({
        function: normalizeFunction(jsc[1]),
        file: stripQuery(jsc[2] ?? ''),
        line: Number(jsc[3]),
        column: Number(jsc[4]),
      });
    }
  }
  return frames;
}
