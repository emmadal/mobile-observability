import 'server-only';

import { requests } from '@/db/schema';
import type { RequestTrace } from './request-trace';

/** Columns selected for a request trace. */
export const requestTraceColumns = {
  id: requests.id,
  timestamp: requests.timestamp,
  method: requests.method,
  host: requests.host,
  path: requests.path,
  statusCode: requests.statusCode,
  durationMs: requests.durationMs,
  ttfbMs: requests.timeToFirstByteMs,
  bytesSent: requests.bytesSent,
  bytesReceived: requests.bytesReceived,
  traceId: requests.traceId,
  networkType: requests.networkType,
  error: requests.error,
  errorMessage: requests.errorMessage,
  url: requests.url,
  contentType: requests.contentType,
  responseBody: requests.responseBody,
  routeName: requests.routeName,
};

interface TraceRow {
  id: number;
  timestamp: Date | string;
  method: string;
  host: string;
  path: string;
  statusCode: number;
  durationMs: number | string;
  ttfbMs: number | string | null;
  bytesSent: number | null;
  bytesReceived: number | null;
  traceId: string | null;
  networkType: string | null;
  error: string | null;
  errorMessage: string | null;
  url: string | null;
  contentType: string | null;
  responseBody: string | null;
  routeName: string | null;
}

/** Normalizes driver types (numeric strings, raw timestamps) into a RequestTrace. */
export function toRequestTrace(row: TraceRow): RequestTrace {
  return {
    id: Number(row.id),
    timestamp: new Date(row.timestamp),
    method: row.method,
    host: row.host,
    path: row.path,
    statusCode: Number(row.statusCode),
    durationMs: Number(row.durationMs),
    ttfbMs: row.ttfbMs === null ? null : Number(row.ttfbMs),
    bytesSent: row.bytesSent,
    bytesReceived: row.bytesReceived,
    traceId: row.traceId,
    networkType: row.networkType,
    error: row.error,
    errorMessage: row.errorMessage,
    url: row.url,
    contentType: row.contentType,
    responseBody: row.responseBody,
    routeName: row.routeName,
  };
}
