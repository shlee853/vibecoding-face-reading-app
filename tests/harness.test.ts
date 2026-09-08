/**
 * 러너 자체 점검용 테스트.
 * 대상 모듈(lib/prompt.ts 등)이 아직 존재하지 않아 다른 테스트 파일들의 컴파일이
 * "Cannot find module" 로 실패하더라도, 이 파일은 어떤 lib/* 모듈도 import하지 않으므로
 * `node --test` 러너 자체가 정상 동작함을 증명한다.
 *
 * 구현이 완료된 뒤에도 회귀 없이 남겨둔다 — 러너 배선이 깨지는 것을 가장 먼저 잡아준다.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('test harness', () => {
  test('산술 연산이 기대한 값을 낸다 (러너 동작 증명)', () => {
    assert.equal(1 + 1, 2);
  });

  test('node:assert/strict 의 실패가 실제로 실패로 취급된다', () => {
    assert.throws(() => assert.equal(1, 2), /AssertionError/);
  });

  test('비동기 테스트도 실행된다', async () => {
    const value = await Promise.resolve(42);
    assert.equal(value, 42);
  });
});
