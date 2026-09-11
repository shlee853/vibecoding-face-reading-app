/**
 * lib/apikey.ts — API 키 형식 검증.
 *
 * 이 테스트는 **실제로 겪은 배포 사고**에서 나왔다.
 * 안내 문서의 자리표시자 `발급받은키` 를 그대로 환경변수에 넣었더니,
 * 키가 HTTP 헤더에 실리는 순간 이런 예외가 났다:
 *
 *   Cannot convert argument to a ByteString because the character at index 0
 *   has a value of 48156 which is greater than 255.
 *
 * 그런데 헬스체크는 "값이 있다"는 이유로 `configured` 라고 보고했고,
 * 앱은 실패가 뻔한 요청을 네 번이나 보냈다. 값의 존재 확인은 검증이 아니다.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { validateApiKey } from '../lib/apikey';

/**
 * 검증을 통과해야 하는 값 (완전한 가짜).
 *
 * 일부러 실제 키 형식을 흉내내지 않는다 — 진짜처럼 생긴 문자열을 테스트에 두면
 * GitHub 시크릿 스캐너가 유출로 오인해 푸시를 막는다. 실제로 한 번 막혔다.
 * 검증 로직이 보는 것은 "ASCII인가 / 자리표시자인가 / 충분히 긴가"뿐이므로
 * 이 값으로도 검증 목적은 그대로 달성된다.
 */
const LOOKS_REAL = 'TESTKEY-0000-1111-2222-3333-4444-5555';

describe('validateApiKey — 정상 키는 통과한다', () => {
  test('실제와 비슷한 키', () => {
    assert.equal(validateApiKey(LOOKS_REAL).ok, true);
  });

  test('앞뒤 공백은 무시한다 — 붙여넣기에 흔히 섞인다', () => {
    assert.equal(validateApiKey(`  ${LOOKS_REAL}\n`).ok, true);
  });
});

describe('validateApiKey — 값이 없을 때', () => {
  for (const [label, value] of [
    ['undefined', undefined],
    ['null', null],
    ['빈 문자열', ''],
    ['공백만', '   '],
  ] as const) {
    test(`${label} → missing`, () => {
      const r = validateApiKey(value);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, 'missing');
    });
  }
});

describe('★ validateApiKey — 실제 사고 재현: 한글 자리표시자', () => {
  test('"발급받은키"를 거부한다 — 이 값이 배포를 망가뜨렸다', () => {
    const r = validateApiKey('발급받은키');
    assert.equal(r.ok, false, '한글 키가 통과하면 같은 사고가 반복된다');
    if (!r.ok) {
      assert.equal(r.reason, 'non-ascii');
      assert.match(r.detail, /자리표시자|ASCII/);
    }
  });

  test('문제를 일으킨 문자를 안내에 담는다 — 사용자가 무엇을 고칠지 알아야 한다', () => {
    const r = validateApiKey('발급받은키');
    if (!r.ok) assert.ok(r.detail.includes('발'), '문제 문자를 알려줘야 한다');
  });

  test('다른 한글 자리표시자들도 거부한다', () => {
    for (const v of ['여기에_실제_키', '실제키', 'AIza한글섞임']) {
      const r = validateApiKey(v);
      assert.equal(r.ok, false, `"${v}" 가 통과했다`);
    }
  });

  test('헤더에 못 싣는 제어문자·비ASCII를 모두 거부한다', () => {
    // 앞뒤 공백은 trim으로 걸러지므로 대상이 아니다 (위에서 통과를 따로 확인함).
    for (const v of [`${LOOKS_REAL}→`, `abc\tdef${LOOKS_REAL}`, `키${LOOKS_REAL}`]) {
      assert.equal(validateApiKey(v).ok, false, `"${v.slice(-8)}" 가 통과했다`);
    }
  });
});

describe('validateApiKey — 영문 자리표시자', () => {
  for (const v of ['your_api_key_here', 'YOUR-API-KEY-GOES-HERE', 'changeme_changeme_xx', 'xxxxxxxxxxxxxxxxxxxxx']) {
    test(`"${v}" → placeholder`, () => {
      const r = validateApiKey(v);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, 'placeholder');
    });
  }
});

describe('validateApiKey — 잘려 붙여넣은 키', () => {
  test('너무 짧으면 거부한다', () => {
    const r = validateApiKey('TESTKEY-9');
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, 'too-short');
      assert.match(r.detail, /\d+자/, '몇 자인지 알려줘야 한다');
    }
  });

  test('경계: 20자 이상이면 통과한다', () => {
    assert.equal(validateApiKey('A'.repeat(20)).ok, true);
    assert.equal(validateApiKey('A'.repeat(19)).ok, false);
  });
});

describe('validateApiKey — 모든 실패에 고칠 방법이 담긴다', () => {
  for (const v of ['', '발급받은키', 'your_api_key_here', 'short']) {
    test(`"${v || '(빈값)'}" 의 안내가 비어있지 않다`, () => {
      const r = validateApiKey(v);
      assert.equal(r.ok, false);
      if (!r.ok) assert.ok(r.detail.trim().length > 10, '안내가 너무 짧다');
    });
  }
});
