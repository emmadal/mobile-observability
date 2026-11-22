import { originalPositionFor, sourceContentFor, TraceMap } from '@jridgewell/trace-mapping';
import type { Frame } from '@mobile-observability/protocol';

export interface SourceContext {
  pre: string[];
  line: string;
  post: string[];
}

export type SymbolicatedFrame = Frame & { context?: SourceContext; symbolicated?: boolean };

export interface LoadedMap {
  map: TraceMap;
  /** Common directory of the app's own sources, stripped for display. */
  projectRoot: string;
  /** Source files split into lines once, on first use. */
  lines: Map<string, string[] | null>;
}

const CONTEXT_LINES = 5;
const MAX_CONTEXT_LINE_LENGTH = 256;
/** Upper bound on frames symbolicated per envelope (500 errors x 100 frames otherwise). */
export const MAX_SYMBOLICATED_FRAMES_PER_ENVELOPE = 5_000;

export function loadMap(raw: string): LoadedMap {
  const map = new TraceMap(raw);
  return {
    map,
    projectRoot: commonRoot(map.sources.filter((s): s is string => !!s)),
    lines: new Map(),
  };
}

function sourceLines(loaded: LoadedMap, source: string): string[] | null {
  let lines = loaded.lines.get(source);
  if (lines === undefined) {
    const content = sourceContentFor(loaded.map, source);
    lines = content ? content.split('\n') : null;
    loaded.lines.set(source, lines);
  }
  return lines;
}

const clip = (line: string) => line.slice(0, MAX_CONTEXT_LINE_LENGTH);

/**
 * The project root is where node_modules lives (every Metro bundle includes
 * react-native from it); otherwise the common directory of all sources.
 */
function commonRoot(sources: string[]): string {
  const withModules = sources.find((source) => source.includes('/node_modules/'));
  if (withModules) return withModules.slice(0, withModules.indexOf('/node_modules/') + 1);
  const absolute = sources.filter((source) => source.startsWith('/'));
  if (absolute.length === 0) return '';
  let prefix = absolute[0]?.slice(0, absolute[0].lastIndexOf('/') + 1) ?? '';
  for (const source of absolute) {
    while (prefix && !source.startsWith(prefix)) {
      prefix = prefix.slice(0, prefix.slice(0, -1).lastIndexOf('/') + 1);
    }
  }
  return prefix;
}

export function displayPath(source: string, projectRoot: string): string {
  const modules = source.lastIndexOf('node_modules/');
  if (modules >= 0) return source.slice(modules);
  if (projectRoot && source.startsWith(projectRoot)) return source.slice(projectRoot.length);
  return source.replace(/^webpack:\/\/\/?/, '');
}

function contextFor(loaded: LoadedMap, source: string, line: number): SourceContext | undefined {
  const lines = sourceLines(loaded, source);
  if (!lines) return undefined;
  const index = line - 1;
  if (index < 0 || index >= lines.length) return undefined;
  return {
    pre: lines.slice(Math.max(0, index - CONTEXT_LINES), index).map(clip),
    line: clip(lines[index] ?? ''),
    post: lines.slice(index + 1, index + 1 + CONTEXT_LINES).map(clip),
  };
}

/**
 * Maps one bundle position to the original source (AC-19). The SDK reports
 * 1-based columns for every frame, including Hermes bytecode offsets, and
 * source maps are 0-based.
 */
export function symbolicateFrame(frame: Frame, loaded: LoadedMap): SymbolicatedFrame {
  if (frame.native || frame.line === undefined || frame.column === undefined || frame.column < 1)
    return frame;
  const position = originalPositionFor(loaded.map, { line: frame.line, column: frame.column - 1 });
  if (position.source === null || position.line === null) return frame;
  const file = displayPath(position.source, loaded.projectRoot);
  const context = contextFor(loaded, position.source, position.line);
  return {
    function: position.name ?? frame.function,
    file,
    line: position.line,
    column: (position.column ?? 0) + 1,
    inApp: !file.includes('node_modules/'),
    symbolicated: true,
    ...(context ? { context } : {}),
  };
}

export function symbolicateFrames(frames: Frame[], loaded: LoadedMap): SymbolicatedFrame[] {
  return frames.map((frame) => symbolicateFrame(frame, loaded));
}

/** Source map lookup keys for the bundle an event ran: the OTA update first, then the build. */
export function bundleKeysFor(app: {
  updateId?: string | null;
  isEmbeddedLaunch?: boolean | null;
  version: string;
  build: string;
}): string[] {
  const keys: string[] = [];
  if (app.updateId && !app.isEmbeddedLaunch) keys.push(`update:${app.updateId}`);
  keys.push(`build:${app.version}+${app.build}`);
  if (app.updateId && app.isEmbeddedLaunch) keys.push(`update:${app.updateId}`);
  return keys;
}
