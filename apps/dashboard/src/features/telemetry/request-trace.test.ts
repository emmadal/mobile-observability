import { describe, expect, it } from 'vitest';
import { formatBytes, formatResponseBody, requestOutcome, statusLabel } from './request-trace';

describe('requestOutcome', () => {
  it('tells network failures (no response) from API errors', () => {
    expect(requestOutcome({ statusCode: 0, error: 'network error' })).toMatchObject({
      kind: 'network',
      label: 'Network error',
      answered: false,
    });
    expect(requestOutcome({ statusCode: 0, error: 'timeout' })).toMatchObject({
      kind: 'network',
      label: 'Timeout',
    });
    expect(requestOutcome({ statusCode: 0, error: 'aborted' }).label).toBe('Aborted');
    expect(requestOutcome({ statusCode: 0, error: null }).kind).toBe('network');
  });

  it('classifies HTTP answers by status class', () => {
    expect(requestOutcome({ statusCode: 503, error: null })).toMatchObject({
      kind: 'server',
      label: 'API error 503',
      answered: true,
    });
    expect(requestOutcome({ statusCode: 404, error: null })).toMatchObject({
      kind: 'client',
      label: 'API error 404',
    });
    expect(requestOutcome({ statusCode: 302, error: null }).kind).toBe('redirect');
    expect(requestOutcome({ statusCode: 200, error: null })).toMatchObject({
      kind: 'ok',
      label: 'OK 200',
    });
  });
});

describe('statusLabel', () => {
  it('names known codes and the missing response', () => {
    expect(statusLabel(401)).toBe('401 Unauthorized');
    expect(statusLabel(0)).toBe('No response');
    expect(statusLabel(599)).toBe('599');
  });
});

describe('formatResponseBody', () => {
  it('pretty-prints JSON and keeps other text as sent', () => {
    expect(formatResponseBody('{"message":"Invalid PIN"}')).toEqual({
      text: '{\n  "message": "Invalid PIN"\n}',
      json: true,
    });
    expect(formatResponseBody('{"message":"cut')).toEqual({ text: '{"message":"cut', json: false });
    expect(formatResponseBody('Bad Gateway')).toEqual({ text: 'Bad Gateway', json: false });
  });
});

describe('formatBytes', () => {
  it('scales to KB and MB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3 MB');
  });
});
