import type { FrameInput } from '@mobile-observability/protocol';
import { parseStack } from './stack-parser';

export interface NormalizedError {
  type: string;
  message: string;
  frames: FrameInput[];
  stack?: string;
}

/** Turns anything that was thrown into a type, message and frames. */
export function normalizeError(thrown: unknown): NormalizedError {
  if (thrown instanceof Error) {
    const type =
      thrown.name && thrown.name !== 'Error' ? thrown.name : thrown.constructor?.name || 'Error';
    return {
      type,
      message: thrown.message ?? '',
      frames: parseStack(thrown.stack),
      stack: thrown.stack,
    };
  }
  if (typeof thrown === 'object' && thrown !== null) {
    const record = thrown as { name?: unknown; message?: unknown; stack?: unknown };
    const message = typeof record.message === 'string' ? record.message : safeStringify(thrown);
    const stack = typeof record.stack === 'string' ? record.stack : undefined;
    return {
      type: typeof record.name === 'string' ? record.name : 'NonErrorThrown',
      message,
      frames: parseStack(stack),
      stack,
    };
  }
  return { type: 'NonErrorThrown', message: String(thrown), frames: [] };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
