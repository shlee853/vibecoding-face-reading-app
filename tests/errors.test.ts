/**
 * lib/errors.ts — messageForCode() / statusForCode() / classifyUpstreamError() /
 * toErrorResponse() 계약 검증.
 * 대응 수락 기준: A6
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  messageForCode,
  statusForCode,
  classifyUpstreamError,
  toErrorResponse,
} from '../lib/errors';
import { ERROR_CODES } from '../lib/types';

// ---- ERROR_CODES 런타임 순회 (코드를 손으로 나열하지 않는다) ------------------

describe('messageForCode / statusForCode — 모든 ERROR_CODES에 대해 성립', () => {
  for (const code of ERROR_CODES) {
    test(`messageForCode("${code}")는 비어있지 않은 문자열을 반환한다`, () => {
      const msg = messageForCode(code);
      assert.equal(typeof msg, 'string');
      assert.ok(msg.trim().length > 0, `"${code}"에 대한 메시지가 비어있다`);
    });

    test(`statusForCode("${code}")는 400~599 범위의 정수를 반환한다`, () => {
      const status = statusForCode(code);
      assert.equal(typeof status, 'number');
      assert.ok(Number.isInteger(status), `"${code}"의 status가 정수가 아니다: ${status}`);
      assert.ok(status >= 400 && status <= 599, `"${code}"의 status가 범위 밖: ${status}`);
    });
  }

  test('입력 오류 코드(NO_IMAGE)는 4xx다', () => {
    const status = statusForCode('NO_IMAGE');
    assert.ok(status >= 400 && status < 500, `NO_IMAGE는 4xx여야 하는데 ${status}`);
  });

  test('입력 오류 코드(BAD_IMAGE_FORMAT)는 4xx다', () => {
    const status = statusForCode('BAD_IMAGE_FORMAT');
    assert.ok(status >= 400 && status < 500, `BAD_IMAGE_FORMAT는 4xx여야 하는데 ${status}`);
  });

  test('입력 오류 코드(IMAGE_TOO_LARGE)는 4xx다', () => {
    const status = statusForCode('IMAGE_TOO_LARGE');
    assert.ok(status >= 400 && status < 500, `IMAGE_TOO_LARGE는 4xx여야 하는데 ${status}`);
  });

  test('설정 오류 코드(NO_API_KEY)는 5xx다', () => {
    const status = statusForCode('NO_API_KEY');
    assert.ok(status >= 500 && status < 600, `NO_API_KEY는 5xx여야 하는데 ${status}`);
  });

  test('업스트림 오류 코드(UPSTREAM_FAILED)는 5xx다', () => {
    const status = statusForCode('UPSTREAM_FAILED');
    assert.ok(status >= 500 && status < 600, `UPSTREAM_FAILED는 5xx여야 하는데 ${status}`);
  });

  test('업스트림 오류 코드(TIMEOUT)는 5xx다', () => {
    const status = statusForCode('TIMEOUT');
    assert.ok(status >= 500 && status < 600, `TIMEOUT은 5xx여야 하는데 ${status}`);
  });
});

// ---- classifyUpstreamError: 3가지 분기 ---------------------------------------

describe('classifyUpstreamError', () => {
  test('메시지에 "API key"가 포함된 에러 → INVALID_API_KEY', () => {
    const code = classifyUpstreamError(new Error('Invalid API key provided'));
    assert.equal(code, 'INVALID_API_KEY');
  });

  test('메시지에 "API_KEY_INVALID"가 포함된 에러 → INVALID_API_KEY', () => {
    const code = classifyUpstreamError(new Error('400 Bad Request: API_KEY_INVALID'));
    assert.equal(code, 'INVALID_API_KEY');
  });

  test('name이 AbortError인 에러 → TIMEOUT', () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    const code = classifyUpstreamError(err);
    assert.equal(code, 'TIMEOUT');
  });

  test('메시지에 "timeout"이 포함된 에러 → TIMEOUT', () => {
    const code = classifyUpstreamError(new Error('request timeout after 30000ms'));
    assert.equal(code, 'TIMEOUT');
  });

  test('그 외 일반 에러 → UPSTREAM_FAILED', () => {
    const code = classifyUpstreamError(new Error('Internal Server Error'));
    assert.equal(code, 'UPSTREAM_FAILED');
  });

  test('Error가 아닌 값(문자열)을 던진 경우에도 안전하게 UPSTREAM_FAILED로 떨어진다', () => {
    const code = classifyUpstreamError('그냥 문자열 에러');
    assert.equal(code, 'UPSTREAM_FAILED');
  });

  test('Error가 아닌 값(plain object)을 던진 경우에도 안전하게 UPSTREAM_FAILED로 떨어진다', () => {
    const code = classifyUpstreamError({ weird: true });
    assert.equal(code, 'UPSTREAM_FAILED');
  });

  test('null/undefined를 던진 경우에도 예외 없이 UPSTREAM_FAILED로 떨어진다', () => {
    assert.equal(classifyUpstreamError(null), 'UPSTREAM_FAILED');
    assert.equal(classifyUpstreamError(undefined), 'UPSTREAM_FAILED');
  });
});

// ---- toErrorResponse: 조립 결과 일관성 ---------------------------------------

describe('toErrorResponse', () => {
  for (const code of ERROR_CODES) {
    test(`"${code}"에 대해 messageForCode/statusForCode와 일치하는 응답을 조립한다`, () => {
      const { body, status } = toErrorResponse(code);
      assert.equal(body.ok, false);
      assert.equal(body.code, code);
      assert.equal(body.message, messageForCode(code));
      assert.equal(status, statusForCode(code));
    });
  }
});
