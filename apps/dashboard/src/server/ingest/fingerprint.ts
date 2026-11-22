import { createHash } from 'node:crypto';
import type { Frame } from '@mobile-observability/protocol';

const FINGERPRINT_FRAMES = 5;

/** A frame is "in app" unless it is native runtime code or comes from node_modules. */
export function isInAppFrame(frame: Frame): boolean {
  if (frame.inApp !== undefined) return frame.inApp;
  if (frame.native) return false;
  const file = frame.file ?? '';
  return !file.includes('node_modules/') && !file.startsWith('[native');
}

/** Frames that came out of a source map carry original file paths, not bundle names. */
function isBundlePosition(frame: Frame): boolean {
  return /\.(bundle|jsbundle|hbc)$/.test(frame.file ?? '');
}

function frameSignature(frame: Frame): string {
  if (frame.native) return `${frame.module ?? ''}|${frame.function ?? ''}`;
  // Minified bundles have meaningless function names: group by exact position.
  if (isBundlePosition(frame)) return `${frame.file}:${frame.line ?? 0}:${frame.column ?? 0}`;
  // Original source: file + function, so edits that shift lines keep the same issue.
  return `${frame.file ?? ''}|${frame.function ?? ''}`;
}

/** Replaces volatile tokens (ids, numbers, hex, quoted values) so messages group. */
export function normalizeMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/0x[0-9a-f]+/gi, '<hex>')
    .replace(/\b[0-9a-f]{12,}\b/gi, '<hex>')
    .replace(/\d+(\.\d+)?/g, '<n>')
    .replace(/(["'`]).*?\1/g, '<str>')
    .trim();
}

/**
 * Groups errors by cause (AC-18): error type plus the top 5 in-app frames.
 * Line numbers and the message are excluded; without frames the normalized
 * message is used instead.
 */
export function computeFingerprint(type: string, frames: Frame[], message: string): string {
  const inApp = frames.filter(isInAppFrame);
  const chosen = (inApp.length > 0 ? inApp : frames).slice(0, FINGERPRINT_FRAMES);
  const parts =
    chosen.length > 0 ? [type, ...chosen.map(frameSignature)] : [type, normalizeMessage(message)];
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

/** `file:line` of the top in-app frame, or the best available description. */
export function culpritOf(frames: Frame[]): string | null {
  const frame = frames.find(isInAppFrame) ?? frames[0];
  if (!frame) return null;
  if (frame.file && !frame.native) {
    const location = frame.line !== undefined ? `${frame.file}:${frame.line}` : frame.file;
    return frame.function ? `${location} in ${frame.function}` : location;
  }
  return frame.function ?? frame.module ?? null;
}
