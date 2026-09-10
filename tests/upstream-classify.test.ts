/**
 * 업스트림 오류 분류와 재시도 판정.
 *
 * 이 로직이 "분석 중 오류가 발생했습니다"가 자주 뜨던 문제의 핵심이다.
 * Gemini SDK는 HTTP 상태를 예외 메시지에 `[429 Too Many Requests] ...` 형태로 싣는다.
 * 여기서 잘못 분류하면 (a) 재시도하면 풀릴 오류를 그대로 사용자에게 던지거나
 * (b) 재시도해도 소용없는 오류를 붙잡고 시간을 버린다.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { classifyUpstreamError, isRetryableCode, messageForCode } from '../lib/errors';
import { ERROR_CODES } from '../lib/types';

/** SDK가 실제로 내는 형태에 가깝게 만든 예외 */
function sdkError(message: string, name = 'GoogleGenerativeAIError'): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

describe('classifyUpstreamError — 일시적 오류를 구분한다', () => {
  test('429는 RATE_LIMITED', () => {
    assert.equal(
      classifyUpstreamError(
        sdkError('[429 Too Many Requests] Resource has been exhausted (RESOURCE_EXHAUSTED)')
      ),
      'RATE_LIMITED'
    );
  });

  test('상태 코드 없이 quota만 언급해도 RATE_LIMITED', () => {
    assert.equal(classifyUpstreamError(sdkError('Quota exceeded for requests')), 'RATE_LIMITED');
  });

  test('503 과부하는 UPSTREAM_BUSY', () => {
    assert.equal(
      classifyUpstreamError(sdkError('[503 Service Unavailable] The model is overloaded.')),
      'UPSTREAM_BUSY'
    );
  });

  test('500도 UPSTREAM_BUSY (일시적으로 보고 재시도한다)', () => {
    assert.equal(
      classifyUpstreamError(sdkError('[500 Internal Server Error] internal error')),
      'UPSTREAM_BUSY'
    );
  });
});

describe('classifyUpstreamError — 재시도해도 소용없는 오류를 구분한다', () => {
  test('안전 필터 차단은 SAFETY_BLOCKED', () => {
    assert.equal(
      classifyUpstreamError(sdkError('Gemini blocked the response (finishReason=SAFETY)', 'SafetyBlockedError')),
      'SAFETY_BLOCKED'
    );
  });

  test('API 키 문제는 INVALID_API_KEY', () => {
    assert.equal(classifyUpstreamError(sdkError('API key not valid')), 'INVALID_API_KEY');
    assert.equal(classifyUpstreamError(sdkError('[403 Forbidden] denied')), 'INVALID_API_KEY');
  });

  test('400은 키 문제로 단정하지 않는다 — 엉뚱한 안내를 막는다', () => {
    assert.notEqual(
      classifyUpstreamError(sdkError('[400 Bad Request] Invalid argument')),
      'INVALID_API_KEY'
    );
  });

  test('타임아웃은 TIMEOUT', () => {
    assert.equal(classifyUpstreamError(sdkError('did not respond within 25000ms', 'TimeoutError')), 'TIMEOUT');
    assert.equal(classifyUpstreamError(sdkError('socket timeout')), 'TIMEOUT');
  });
});

describe('classifyUpstreamError — 무엇이 들어와도 던지지 않는다', () => {
  for (const value of [null, undefined, 'string', 42, {}, []]) {
    test(`${JSON.stringify(value) ?? String(value)} → UPSTREAM_FAILED (예외 없음)`, () => {
      assert.equal(classifyUpstreamError(value), 'UPSTREAM_FAILED');
    });
  }
});

describe('isRetryableCode — 재시도 대상', () => {
  const shouldRetry = ['RATE_LIMITED', 'UPSTREAM_BUSY', 'UPSTREAM_FAILED', 'UNPARSABLE_RESPONSE'];

  for (const code of ERROR_CODES) {
    const expected = shouldRetry.includes(code);
    test(`${code} → ${expected ? '재시도함' : '재시도 안 함'}`, () => {
      assert.equal(isRetryableCode(code), expected);
    });
  }

  test('사용자가 직접 고쳐야 하는 오류는 재시도하지 않는다', () => {
    // 같은 요청을 다시 보내도 결과가 같다 — 재시도는 시간만 버린다.
    for (const code of ['NO_IMAGE', 'BAD_IMAGE_FORMAT', 'IMAGE_TOO_LARGE', 'NO_FACE'] as const) {
      assert.equal(isRetryableCode(code), false, `${code}는 재시도 대상이 아니어야 한다`);
    }
  });

  test('키 설정 문제와 안전 차단도 재시도하지 않는다', () => {
    for (const code of ['NO_API_KEY', 'INVALID_API_KEY', 'SAFETY_BLOCKED'] as const) {
      assert.equal(isRetryableCode(code), false, `${code}는 재시도 대상이 아니어야 한다`);
    }
  });

  test('타임아웃은 이미 오래 기다린 뒤라 재시도하지 않는다', () => {
    assert.equal(isRetryableCode('TIMEOUT'), false);
  });
});

describe('새 오류 코드도 사용자에게 보여줄 한국어 메시지가 있다', () => {
  for (const code of ['RATE_LIMITED', 'UPSTREAM_BUSY', 'SAFETY_BLOCKED'] as const) {
    test(`${code}`, () => {
      const msg = messageForCode(code);
      assert.ok(msg.trim().length > 0, '메시지가 비어있다');
      assert.ok(/[가-힣]/.test(msg), '한국어 메시지가 아니다');
    });
  }
});
