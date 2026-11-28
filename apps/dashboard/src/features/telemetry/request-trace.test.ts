import { describe, expect, it } from 'vitest';
import {
  bodyMessage,
  bodyReportsFailure,
  displayUrl,
  formatBytes,
  formatResponseBody,
  requestOutcome,
  statusLabel,
  userLabel,
} from './request-trace';

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

describe('userLabel', () => {
  it('reads as msisdn:segment', () => {
    expect(userLabel({ userPhone: '231770000001', userSegment: 'KYA', userId: 'kya:1' })).toBe(
      '231770000001:kya',
    );
    // An id shaped "segment:msisdn" is turned around when no phone was sent.
    expect(userLabel({ userPhone: null, userSegment: null, userId: 'merchant:231880000002' })).toBe(
      '231880000002:merchant',
    );
    expect(userLabel({ userPhone: '231770000001', userSegment: null, userId: null })).toBe(
      '231770000001',
    );
    expect(userLabel({ userPhone: null, userSegment: 'ftth', userId: 'u-42' })).toBe('u-42:ftth');
    expect(userLabel({ userPhone: null, userSegment: null, userId: null })).toBeNull();
  });
});

describe('displayUrl', () => {
  it('prefers the full URL as called, without its scheme', () => {
    expect(
      displayUrl({
        url: 'https://api.example.com/kyc/42?x=1',
        host: 'api.example.com',
        path: '/kyc/:id',
      }),
    ).toBe('api.example.com/kyc/42?x=1');
    expect(displayUrl({ url: null, host: 'api.example.com', path: '/kyc/:id' })).toBe(
      'api.example.com/kyc/:id',
    );
  });
});

describe('bodyMessage', () => {
  it('finds the sentence the API answered with', () => {
    expect(bodyMessage('{"status":false,"message":"Subscriber not found"}')).toBe(
      'Subscriber not found',
    );
    expect(bodyMessage('{"error":{"code":"E1","message":"Token expired"}}')).toBe('Token expired');
    expect(bodyMessage('{"msg":"  ok\n done "}')).toBe('ok done');
    expect(bodyMessage('{"message":"[redacted]"}')).toBeNull();
    expect(bodyMessage('{"data":[1,2]}')).toBeNull();
    expect(bodyMessage('<html>502</html>')).toBeNull();
    expect(bodyMessage(null)).toBeNull();
  });

  it('searches a body cut by the size limit as text', () => {
    expect(bodyMessage('{"message":"Agent suspended","rows":[{"id":1},{"id":')).toBe(
      'Agent suspended',
    );
  });
});

describe('bodyReportsFailure', () => {
  it('spots failures an API reports inside a 200 answer', () => {
    expect(bodyReportsFailure('{"success":false}')).toBe(true);
    expect(bodyReportsFailure('{"status":false,"message":"x"}')).toBe(true);
    expect(bodyReportsFailure('{"status":"FAILED"}')).toBe(true);
    expect(bodyReportsFailure('{"error":"Invalid MSISDN"}')).toBe(true);
    expect(bodyReportsFailure('{"errors":[{"field":"msisdn"}]}')).toBe(true);
    expect(bodyReportsFailure('{"code":404,"data":null}')).toBe(true);
  });

  it('leaves real successes alone', () => {
    expect(bodyReportsFailure('{"success":true,"data":{}}')).toBe(false);
    expect(bodyReportsFailure('{"status":"SUCCESS"}')).toBe(false);
    expect(bodyReportsFailure('{"error":null,"errors":{},"code":200}')).toBe(false);
    expect(bodyReportsFailure('[{"id":1}]')).toBe(false);
    expect(bodyReportsFailure('not json')).toBe(false);
    expect(bodyReportsFailure(null)).toBe(false);
  });
});
