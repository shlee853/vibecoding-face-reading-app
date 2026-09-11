/**
 * lib/ratelimit.ts — 공개 배포에서 API 비용을 지키는 장치.
 *
 * 이 로직이 헐거우면 한 사람이 새로고침만 반복해도 무료 한도가 사라지고,
 * 유료 전환 후라면 그대로 청구서가 된다. 그래서 경계 조건까지 못박는다.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkRateLimit,
  clientKeyFromHeaders,
  createHitStore,
  sweepHitStore,
  DEFAULT_RULES,
  type RateLimitRule,
} from '../lib/ratelimit';

const RULES: RateLimitRule[] = [
  { name: 'burst', windowMs: 60_000, max: 3 },
  { name: 'daily', windowMs: 24 * 60 * 60_000, max: 10 },
];

describe('checkRateLimit — 창 안에서 허용량을 지킨다', () => {
  test('허용량까지는 통과한다', () => {
    const store = createHitStore();
    for (let i = 1; i <= 3; i++) {
      const d = checkRateLimit(store, 'ip-a', 1_000 * i, RULES);
      assert.equal(d.allowed, true, `${i}번째 요청은 통과해야 한다`);
    }
  });

  test('허용량을 넘으면 막고 어느 규칙인지 알려준다', () => {
    const store = createHitStore();
    for (let i = 1; i <= 3; i++) checkRateLimit(store, 'ip-a', 1_000 * i, RULES);

    const d = checkRateLimit(store, 'ip-a', 4_000, RULES);
    assert.equal(d.allowed, false);
    assert.equal(d.blockedBy, 'burst');
    assert.ok(d.retryAfterSec > 0, '다시 시도 가능한 시점을 알려줘야 한다');
  });

  test('키가 다르면 서로 영향을 주지 않는다', () => {
    const store = createHitStore();
    for (let i = 1; i <= 3; i++) checkRateLimit(store, 'ip-a', 1_000 * i, RULES);

    assert.equal(checkRateLimit(store, 'ip-b', 4_000, RULES).allowed, true);
  });
});

describe('checkRateLimit — 창이 지나면 풀린다', () => {
  test('창을 벗어난 기록은 세지 않는다', () => {
    const store = createHitStore();
    for (let i = 1; i <= 3; i++) checkRateLimit(store, 'ip-a', 1_000 * i, RULES);
    assert.equal(checkRateLimit(store, 'ip-a', 4_000, RULES).allowed, false);

    // 첫 요청(1초)이 60초 창을 빠져나간 시점
    assert.equal(checkRateLimit(store, 'ip-a', 62_000, RULES).allowed, true);
  });

  test('★ 거부된 요청은 세지 않는다 — 한번 막힌 사람이 영원히 막히면 안 된다', () => {
    const store = createHitStore();
    for (let i = 1; i <= 3; i++) checkRateLimit(store, 'ip-a', 1_000 * i, RULES);

    // 창 안에서 계속 두드린다 (전부 거부)
    for (let t = 4_000; t < 60_000; t += 1_000) {
      assert.equal(checkRateLimit(store, 'ip-a', t, RULES).allowed, false);
    }

    // 거부를 기록에 넣었다면 창이 계속 밀려 여기서도 막혔을 것이다.
    assert.equal(
      checkRateLimit(store, 'ip-a', 62_000, RULES).allowed,
      true,
      '거부된 요청까지 세면 사용자가 영구히 갇힌다'
    );
  });

  test('retryAfterSec가 실제로 풀리는 시점과 맞는다', () => {
    const store = createHitStore();
    for (let i = 1; i <= 3; i++) checkRateLimit(store, 'ip-a', 1_000 * i, RULES);

    const at = 10_000;
    const d = checkRateLimit(store, 'ip-a', at, RULES);
    assert.equal(d.allowed, false);

    // 알려준 시간만큼 기다리면 통과해야 한다.
    const later = at + d.retryAfterSec * 1000;
    assert.equal(checkRateLimit(store, 'ip-a', later, RULES).allowed, true);
  });
});

describe('checkRateLimit — 하루 한도가 별도로 작동한다', () => {
  test('짧은 창은 피해가도 하루 한도에는 걸린다', () => {
    const store = createHitStore();
    const hour = 60 * 60_000;

    // 1시간 간격으로 10번 — burst(분당 3회)에는 절대 걸리지 않는다
    for (let i = 0; i < 10; i++) {
      const d = checkRateLimit(store, 'ip-a', i * hour, RULES);
      assert.equal(d.allowed, true, `${i + 1}번째는 통과해야 한다`);
    }

    const d = checkRateLimit(store, 'ip-a', 10 * hour, RULES);
    assert.equal(d.allowed, false, '하루 한도를 넘겼는데 통과했다');
    assert.equal(d.blockedBy, 'daily');
  });
});

describe('기본 규칙이 비용을 실제로 묶는다', () => {
  test('하루 한도가 정해져 있다 — 무제한이면 배포하면 안 된다', () => {
    const daily = DEFAULT_RULES.find((r) => r.name === 'daily');
    assert.ok(daily, '하루 한도 규칙이 있어야 한다');
    assert.ok(daily.max > 0 && daily.max <= 100, `하루 한도가 비현실적이다: ${daily.max}`);
  });

  test('연타를 막는 짧은 창이 있다', () => {
    const burst = DEFAULT_RULES.find((r) => r.name === 'burst');
    assert.ok(burst, '연타 방지 규칙이 있어야 한다');
    assert.ok(burst.windowMs <= 10 * 60_000, '연타 창이 너무 길다');
  });

  test('기본 규칙으로도 한 IP가 무한히 쓰지 못한다', () => {
    const store = createHitStore();
    let allowed = 0;
    // 하루 동안 1분 간격으로 계속 두드려본다
    for (let t = 0; t < 24 * 60 * 60_000; t += 60_000) {
      if (checkRateLimit(store, 'ip-a', t).allowed) allowed += 1;
    }
    const daily = DEFAULT_RULES.find((r) => r.name === 'daily')!;
    assert.ok(allowed <= daily.max, `하루에 ${allowed}회나 통과했다 (한도 ${daily.max})`);
  });
});

describe('sweepHitStore — 메모리가 무한히 자라지 않는다', () => {
  test('오래된 키만 버리고 최근 키는 남긴다', () => {
    const DAY = 24 * 60 * 60_000;
    const store = createHitStore();
    checkRateLimit(store, 'old-ip', 0, RULES);
    checkRateLimit(store, 'new-ip', 100_000, RULES);

    // old-ip(0초)는 창 밖, new-ip(100초)는 창 안이 되는 시점에서 쓸어낸다.
    const removed = sweepHitStore(store, DAY + 50_000, DAY);

    assert.equal(removed, 1, '오래된 키 하나만 지워져야 한다');
    assert.equal(store.has('old-ip'), false, '오래된 키가 남아 있다');
    assert.equal(store.has('new-ip'), true, '최근 키까지 지우면 안 된다');
  });

  test('살아 있는 키는 남긴다', () => {
    const store = createHitStore();
    checkRateLimit(store, 'ip-a', 1_000, RULES);
    sweepHitStore(store, 2_000, 24 * 60 * 60_000);
    assert.equal(store.has('ip-a'), true);
  });
});

describe('clientKeyFromHeaders — nginx 뒤에서 실제 클라이언트를 찾는다', () => {
  const headersOf = (map: Record<string, string>) => ({
    get: (name: string) => map[name.toLowerCase()] ?? null,
  });

  test('x-forwarded-for의 맨 앞 값을 쓴다', () => {
    const key = clientKeyFromHeaders(headersOf({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }));
    assert.equal(key, '203.0.113.5');
  });

  test('x-real-ip로 대체한다', () => {
    assert.equal(clientKeyFromHeaders(headersOf({ 'x-real-ip': '203.0.113.9' })), '203.0.113.9');
  });

  test('★ 식별 불가여도 고정 키를 쓴다 — 빈 키면 제한을 통째로 우회한다', () => {
    const key = clientKeyFromHeaders(headersOf({}));
    assert.ok(key.length > 0, '빈 키를 반환하면 제한이 무력화된다');
    assert.equal(key, 'unknown');
  });
});
