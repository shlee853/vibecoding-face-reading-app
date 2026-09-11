/**
 * lib/prompt.ts — 관상 파트와 운세 파트, 두 프롬프트의 계약 검증.
 *
 * 스프린트 4에서 분석을 두 번 병렬 호출로 나눴다. 그래서 스키마 키도 두 프롬프트에
 * 나뉘어 들어간다. **나눴다고 검증이 느슨해지면 안 되므로**, 어느 키가 어느 프롬프트에
 * 있어야 하는지를 명시적으로 못박는다. 합쳐서 보면 예전에 요구하던 키가 하나도 빠지지 않는다.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildFacePrompt, buildFortunePrompt } from '../lib/prompt';

/** 관상 프롬프트가 요구해야 하는 키 */
const FACE_KEYS = [
  'faceDetected',
  'features',
  'forehead',
  'eyes',
  'nose',
  'mouth',
  'chin',
  'personality',
  'summary',
  'strengths',
  'weaknesses',
  'social',
];

/** 운세 프롬프트가 요구해야 하는 키 */
const FORTUNE_KEYS = [
  'faceDetected',
  'saju',
  'element',
  'elementReason',
  'fortune',
  'advice',
  'love',
  'idealPartner',
  'type',
  'traits',
  'reason',
  'romance',
  'tendency',
  'caution',
];

const REQUIRED_ELEMENTS = ['목', '화', '토', '금', '수'];

/** 예전 단일 프롬프트가 요구하던 키 전체 — 둘을 합치면 하나도 빠지면 안 된다 */
const ALL_LEGACY_KEYS = [...new Set([...FACE_KEYS, ...FORTUNE_KEYS])];

describe('buildFacePrompt — 관상 파트', () => {
  test('비어있지 않은 문자열을 반환한다', () => {
    const prompt = buildFacePrompt();
    assert.equal(typeof prompt, 'string');
    assert.ok(prompt.trim().length > 0, '프롬프트가 비어있다');
  });

  test('호출할 때마다 같은 내용을 반환한다 (부작용 없음)', () => {
    assert.equal(buildFacePrompt(), buildFacePrompt());
  });

  for (const key of FACE_KEYS) {
    test(`스키마 키 "${key}" 를 문자 그대로 포함한다`, () => {
      assert.ok(buildFacePrompt().includes(key), `관상 프롬프트에 키 "${key}" 가 없다`);
    });
  }

  test('얼굴이 없을 때의 탈출구를 안내한다', () => {
    assert.ok(buildFacePrompt().includes('"faceDetected": false'));
  });
});

describe('buildFortunePrompt — 운세·애정 파트', () => {
  test('비어있지 않은 문자열을 반환한다', () => {
    const prompt = buildFortunePrompt();
    assert.equal(typeof prompt, 'string');
    assert.ok(prompt.trim().length > 0, '프롬프트가 비어있다');
  });

  test('호출할 때마다 같은 내용을 반환한다 (부작용 없음)', () => {
    assert.equal(buildFortunePrompt(), buildFortunePrompt());
  });

  for (const key of FORTUNE_KEYS) {
    test(`스키마 키 "${key}" 를 문자 그대로 포함한다`, () => {
      assert.ok(buildFortunePrompt().includes(key), `운세 프롬프트에 키 "${key}" 가 없다`);
    });
  }

  for (const el of REQUIRED_ELEMENTS) {
    test(`오행 "${el}" 을 포함한다`, () => {
      assert.ok(buildFortunePrompt().includes(el), `운세 프롬프트에 오행 "${el}" 이 없다`);
    });
  }

  test('얼굴이 없을 때의 탈출구를 안내한다', () => {
    assert.ok(buildFortunePrompt().includes('"faceDetected": false'));
  });
});

describe('두 프롬프트를 합치면 기존 스키마 키가 하나도 빠지지 않는다 (회귀)', () => {
  for (const key of ALL_LEGACY_KEYS) {
    test(`"${key}"`, () => {
      const combined = buildFacePrompt() + buildFortunePrompt();
      assert.ok(combined.includes(key), `어느 프롬프트에도 "${key}" 가 없다`);
    });
  }
});

// ---- 외모 평가 가드레일 --------------------------------------------------------
// 주의: 정확한 문구를 강제할 수 없어 핵심어 존재로만 판정한다. 이 검사는 느슨하다 —
// 취지와 반대되는 문장을 실수로 써도 잡아내지 못한다. 최종 판정은 사람이 원문을 읽고 한다.

describe('외모 평가 가드레일 (느슨한 검사 — 최종 판정은 사람이)', () => {
  test('가드레일은 애정 파트를 만드는 운세 프롬프트에 있어야 한다', () => {
    const prompt = buildFortunePrompt();
    assert.ok(prompt.includes('성향'), '"성향" 중심으로 쓰라는 지시가 보이지 않는다');
    assert.ok(prompt.includes('외모'), '"외모" 관련 가드레일이 보이지 않는다');
  });

  test('금지 표현을 구체적으로 열거한다 — 원칙만 적으면 모델이 비껴간다', () => {
    const prompt = buildFortunePrompt();
    assert.ok(prompt.includes('미남형') || prompt.includes('미녀형'), '금지 예시가 없다');
  });

  test('성별을 단정하지 말라는 지시가 있다', () => {
    assert.ok(buildFortunePrompt().includes('성별'), '성별 중립 지시가 보이지 않는다');
  });
});

// ---- 분량·밀도 요구 (유료 서비스 품질) ------------------------------------------

describe('충실한 분량을 요구한다', () => {
  test('관상 프롬프트가 부위별 서술 분량을 명시한다', () => {
    assert.ok(/\d~\d문장/.test(buildFacePrompt()), '문장 수 요구가 없다');
  });

  test('운세 프롬프트가 서술 분량을 명시한다', () => {
    assert.ok(/\d~\d문장/.test(buildFortunePrompt()), '문장 수 요구가 없다');
  });

  test('두루뭉술한 일반론을 금지한다 — 이 지시가 빠지면 내용이 빈약해진다', () => {
    for (const [name, prompt] of [
      ['관상', buildFacePrompt()],
      ['운세', buildFortunePrompt()],
    ] as const) {
      assert.ok(prompt.includes('일반론'), `${name} 프롬프트에 일반론 금지 지시가 없다`);
    }
  });
});
