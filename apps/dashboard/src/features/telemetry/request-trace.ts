/**
 * One captured HTTP request and how to read it: did it fail on the network
 * (no response) or did the API answer with an error? Pure module, shared by
 * server pages and client sheets.
 */

export interface RequestTrace {
  id: number;
  timestamp: Date;
  method: string;
  host: string;
  path: string;
  /** 0 when no response arrived. */
  statusCode: number;
  durationMs: number;
  /** Time to first response byte, when captured. */
  ttfbMs: number | null;
  bytesSent: number | null;
  bytesReceived: number | null;
  /** W3C trace id the SDK propagated upstream in `traceparent`. */
  traceId: string | null;
  /** Connection type reported by the SDK's native layer: wifi, cellular... */
  networkType: string | null;
  /** Failure kind when no response arrived: network error, timeout, aborted. */
  error: string | null;
  /** The platform's own failure message, e.g. "The request timed out." */
  errorMessage: string | null;
  /** Full URL as called (SDK opt-in `networkFullUrls`), credential values redacted. */
  url: string | null;
  /** `Content-Type` of the response. */
  contentType: string | null;
  /** Redacted start of the response body (SDK opt-in `networkResponseBodies`). */
  responseBody: string | null;
  /** Screen the app was on. */
  routeName: string | null;
}

/** A request listed outside its session: where it came from and who sent it. */
export interface NetworkRequest extends RequestTrace {
  projectName: string;
  appVersion: string;
  platform: 'ios' | 'android';
  sessionId: string | null;
  /** Database id of the session, when the session row exists. */
  sessionRowId: number | null;
  userId: string | null;
  userPhone: string | null;
  /** Segment of the session's user: kyc, kya, ftth, merchant... */
  userSegment: string | null;
}

export type RequestOutcomeKind = 'ok' | 'redirect' | 'client' | 'server' | 'network';

export interface RequestOutcome {
  kind: RequestOutcomeKind;
  /** Short label: "Network error", "API error 404"... */
  label: string;
  /** One sentence on what happened and where to look. */
  explanation: string;
  /** Whether the server answered at all. */
  answered: boolean;
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/** "404 Not Found", "0 (no response)". */
export function statusLabel(statusCode: number): string {
  if (statusCode === 0) return 'No response';
  const text = STATUS_TEXT[statusCode];
  return text ? `${statusCode} ${text}` : String(statusCode);
}

/** Classifies a request: transport failure, API error (4xx/5xx) or success. */
export function requestOutcome(
  request: Pick<RequestTrace, 'statusCode' | 'error'>,
): RequestOutcome {
  const { statusCode, error } = request;
  if (error || statusCode === 0) {
    const kind = (error ?? '').toLowerCase();
    if (kind === 'timeout') {
      return {
        kind: 'network',
        label: 'Timeout',
        explanation:
          'No response before the timeout: the server was too slow or the connection stalled. Check the API latency and the device network.',
        answered: false,
      };
    }
    if (kind === 'aborted') {
      return {
        kind: 'network',
        label: 'Aborted',
        explanation:
          'The app cancelled the request before a response arrived (AbortController, screen left, or its own timeout).',
        answered: false,
      };
    }
    return {
      kind: 'network',
      label: 'Network error',
      explanation:
        'The request never got a response: the device was offline, DNS or TLS failed, or the connection dropped. The API did not answer.',
      answered: false,
    };
  }
  if (statusCode >= 500) {
    return {
      kind: 'server',
      label: `API error ${statusCode}`,
      explanation:
        'The API answered with a server error: the failure is on the backend. The response body and the trace id lead to its logs.',
      answered: true,
    };
  }
  if (statusCode >= 400) {
    return {
      kind: 'client',
      label: `API error ${statusCode}`,
      explanation:
        'The API rejected the request (validation, authentication, permission or missing resource). The response body says why.',
      answered: true,
    };
  }
  if (statusCode >= 300) {
    return {
      kind: 'redirect',
      label: `Redirect ${statusCode}`,
      explanation: 'The API answered with a redirect.',
      answered: true,
    };
  }
  return {
    kind: 'ok',
    label: `OK ${statusCode}`,
    explanation: 'The API answered successfully.',
    answered: true,
  };
}

/** Pretty-printed JSON when the body parses, the raw text otherwise. */
export function formatResponseBody(body: string): { text: string; json: boolean } {
  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return { text: JSON.stringify(JSON.parse(trimmed), null, 2), json: true };
    } catch {
      // A truncated or invalid JSON body is shown as sent.
    }
  }
  return { text: body, json: false };
}

const bytes = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

/** "512 B", "1.5 KB", "2.3 MB". */
export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${bytes.format(value / 1024)} KB`;
  return `${bytes.format(value / (1024 * 1024))} MB`;
}

/**
 * Who sent a request, as "msisdn:segment" (e.g. "231770000001:kya"): the
 * phone and segment the app passed to Observe.setUser, else an id shaped
 * "segment:msisdn" turned around, else the bare id. Null when anonymous.
 */
export function userLabel(user: {
  userPhone: string | null;
  userSegment: string | null;
  userId: string | null;
}): string | null {
  const segment = user.userSegment?.toLowerCase() ?? null;
  if (user.userPhone) return segment ? `${user.userPhone}:${segment}` : user.userPhone;
  if (!user.userId) return null;
  const prefixed = /^([A-Za-z][A-Za-z0-9_-]{0,31}):(.+)$/.exec(user.userId);
  if (prefixed?.[1] && prefixed[2]) return `${prefixed[2]}:${prefixed[1].toLowerCase()}`;
  return segment ? `${user.userId}:${segment}` : user.userId;
}

/** The URL as called when the SDK sent it, else host and templated path. */
export function calledUrl(trace: Pick<RequestTrace, 'url' | 'host' | 'path'>): string {
  return trace.url ?? `${trace.host}${trace.path}`;
}

/** "https://api.example.com/a?b=1" without its scheme, for compact display. */
export function displayUrl(trace: Pick<RequestTrace, 'url' | 'host' | 'path'>): string {
  return calledUrl(trace).replace(/^https?:\/\//i, '');
}

function parseJsonObject(body: string): Record<string, unknown> | null {
  const trimmed = body.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const MESSAGE_KEYS = [
  'message',
  'msg',
  'error_description',
  'errorMessage',
  'error',
  'detail',
  'title',
  'description',
  'statusMessage',
  'responseMessage',
];
const MAX_BODY_MESSAGE = 160;

function shortText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || text === '[redacted]') return null;
  return text.length > MAX_BODY_MESSAGE ? `${text.slice(0, MAX_BODY_MESSAGE - 1)}…` : text;
}

/**
 * The short sentence an API put in its JSON answer ("Subscriber not found"),
 * read from the usual keys (message, msg, error, error.message, detail...).
 * A body cut by the size limit is searched as text. Null when there is none.
 */
export function bodyMessage(body: string | null): string | null {
  if (!body) return null;
  const json = parseJsonObject(body);
  if (json) {
    for (const key of MESSAGE_KEYS) {
      const value = json[key];
      const direct = shortText(value);
      if (direct) return direct;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = shortText((value as Record<string, unknown>).message);
        if (nested) return nested;
      }
    }
    return null;
  }
  const match =
    /"(message|msg|error_description|errorMessage|error|detail)"\s*:\s*"((?:[^"\\]|\\.){1,400})"/.exec(
      body,
    );
  return shortText(match?.[2]);
}

const FAILED_STATUS_WORDS = new Set(['error', 'failed', 'failure', 'fail', 'ko', 'nok', 'denied']);

/**
 * Whether a JSON answer reports a failure even though the HTTP status says
 * success, the way many APIs answer 200 with `{ "success": false }`,
 * `{ "status": "FAILED" }`, `{ "error": "..." }` or `{ "code": 404 }`.
 */
export function bodyReportsFailure(body: string | null): boolean {
  if (!body) return false;
  const json = parseJsonObject(body);
  if (!json) return false;
  if (json.success === false || json.ok === false || json.status === false) return true;
  for (const key of ['status', 'result', 'state']) {
    const value = json[key];
    if (typeof value === 'string' && FAILED_STATUS_WORDS.has(value.trim().toLowerCase())) {
      return true;
    }
  }
  const error = json.error;
  if ((typeof error === 'string' && error.trim()) || (error && typeof error === 'object')) {
    return true;
  }
  const errors = json.errors;
  if (errors && typeof errors === 'object' && Object.keys(errors).length > 0) return true;
  for (const key of ['code', 'statusCode', 'status']) {
    const value = json[key];
    if (typeof value === 'number' && value >= 400 && value <= 599) return true;
  }
  return false;
}
