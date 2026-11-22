import type {
  BreadcrumbInput,
  ErrorKind,
  FrameInput,
  ItemInput,
} from '@mobile-observability/protocol';
import type { EnvelopeContext } from '../transport/queue';

/** Context mirrored into the native layer so crashes can be attributed on the next launch. */
export interface CrashContext {
  sessionId?: string;
  routeName?: string;
  breadcrumbs: BreadcrumbInput[];
  envelope: EnvelopeContext;
}

/** A JS fatal persisted synchronously by the native layer before the app dies. */
export interface JsFatalReport {
  id: string;
  kind: 'js_fatal';
  item: ItemInput;
  context: EnvelopeContext;
}

interface NativeReport {
  id: string;
  kind: string;
  type?: string;
  message?: string;
  fatal?: boolean;
  timestamp?: number;
  frames?: FrameInput[];
  rawStack?: string;
  context?: Partial<CrashContext> | null;
}

const NATIVE_KINDS: Record<string, ErrorKind> = {
  signal: 'signal',
  exception: 'exception',
  native_crash: 'native_crash',
  anr: 'anr',
  hang: 'hang',
  oom: 'oom',
};

export interface ConvertedReport {
  id: string;
  item: ItemInput;
  context: EnvelopeContext;
}

/**
 * Converts a report written by the native layer (or a persisted JS fatal) into
 * a queue item plus the envelope context of the launch in which it happened.
 */
export function convertPendingReport(
  raw: string,
  fallbackContext: EnvelopeContext,
): ConvertedReport | null {
  let report: NativeReport | JsFatalReport;
  try {
    report = JSON.parse(raw) as NativeReport | JsFatalReport;
  } catch {
    return null;
  }
  if (!report || typeof report.id !== 'string') return null;

  if (report.kind === 'js_fatal') {
    const fatal = report as JsFatalReport;
    if (!fatal.item) return null;
    return { id: fatal.id, item: fatal.item, context: fatal.context ?? fallbackContext };
  }

  const native = report as NativeReport;
  const kind = NATIVE_KINDS[native.kind];
  if (!kind) return null;
  const crashContext = native.context ?? undefined;
  const item: ItemInput = {
    type: 'error',
    eventId: native.id.toLowerCase(),
    timestamp: Math.round(native.timestamp ?? Date.now()),
    origin: 'native',
    kind,
    fatal: native.fatal ?? true,
    handled: false,
    exception: {
      type: native.type || 'NativeCrash',
      message: native.message ?? '',
      frames: Array.isArray(native.frames) ? native.frames : [],
    },
    breadcrumbs: crashContext?.breadcrumbs ?? [],
    ...(native.rawStack ? { rawStack: native.rawStack } : {}),
    ...(crashContext?.sessionId ? { sessionId: crashContext.sessionId } : {}),
    ...(crashContext?.routeName ? { routeName: crashContext.routeName } : {}),
  };
  return { id: native.id, item, context: crashContext?.envelope ?? fallbackContext };
}
