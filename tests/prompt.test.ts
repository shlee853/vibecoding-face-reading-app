/**
 * lib/prompt.ts — buildAnalysisPrompt() 계약 검증.
 * 대응 수락 기준: A2(애정 키 포함), A3(외모 평가 가드레일), 기존 스키마 키 회귀.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalysisPrompt } from '../lib/prompt';

// 프롬프트가 모델에게 요구해야 하는 JSON 스키마 키 이름들 (스프린트 2, 회귀).
// 손으로 하나씩 assert 하지 않고 배열로 두어 순회한다 — 키가 빠지면 어느 것이 빠졌는지
// 테스트 이름에 그대로 드러난다.
const REQUIRED_KEYS = [
  'faceDetected',
  'features',
  'personality',
  'saju',
  'forehead',
  'eyes',
  'nose',
  'mouth',
  'chin',
  'summary',
  'strengths',
  'weaknesses',
  'social',
  'element',
  'elementReason',
  'fortune',
  'advice',
];

// 스프린트 3에서 추가된 애정 관련 스키마 키 9개 (A2).
const LOVE_KEYS = [
  'love',
  'idealPartner',
  'type',
  'traits',
  'reason',
  'romance',
  'tendency',
  'fortune',
  'caution',
];

const REQUIRED_ELEMENTS = ['목', '화', '토', '금', '수'];

describe('buildAnalysisPrompt', () => {
  test('비어있지 않은 문자열을 반환한다', () => {
    const prompt = buildAnalysisPrompt();
    assert.equal(typeof prompt, 'string');
    assert.ok(prompt.trim().length > 0, '프롬프트가 비어있다');
  });

  test('호출할 때마다 순수하게 같은 내용을 반환한다 (부작용 없음)', () => {
    const a = buildAnalysisPrompt();
    const b = buildAnalysisPrompt();
    assert.equal(a, b);
  });

  for (const key of REQUIRED_KEYS) {
    test(`JSON 스키마 키 "${key}" 를 문자 그대로 포함한다 (회귀)`, () => {
      const prompt = buildAnalysisPrompt();
      assert.ok(
        prompt.includes(key),
        `프롬프트에 키 "${key}" 가 없다:\n${prompt}`
      );
    });
  }

  for (const el of REQUIRED_ELEMENTS) {
    test(`오행 "${el}" 을 포함한다 (회귀)`, () => {
      const prompt = buildAnalysisPrompt();
      assert.ok(
        prompt.includes(el),
        `프롬프트에 오행 "${el}" 이 없다:\n${prompt}`
      );
    });
  }
});

// ---- A2: 애정 관련 스키마 키 9종을 모두 포함한다 --------------------------------

describe('buildAnalysisPrompt — 애정 스키마 키 포함 (A2)', () => {
  for (const key of LOVE_KEYS) {
    test(`애정 스키마 키 "${key}" 를 문자 그대로 포함한다`, () => {
      const prompt = buildAnalysisPrompt();
      assert.ok(
        prompt.includes(key),
        `프롬프트에 애정 키 "${key}" 가 없다:\n${prompt}`
      );
    });
  }
});

// ---- A3: 외모 평가 가드레일 ----------------------------------------------------
// 주의: 정확한 문구를 강제할 수 없어 핵심어("외모", "성향") 존재로만 판정한다.
// 이 검사는 느슨하다 — "외모"와 "성향"이라는 단어가 프롬프트 어딘가에 있기만 하면
// 통과하므로, 실제로 "우열을 매기지 말라"는 취지와 반대되는 문장(예: "외모가 뛰어나
// 보이므로 ~한 상대가 어울립니다" 같은 등급화 예시)을 실수로 작성해도 이 테스트는
// 잡아내지 못한다. 최종 판정은 사람이 프롬프트 원문을 읽고 해야 한다 (보고서 4번 참고).

describe('buildAnalysisPrompt — 외모 평가 가드레일 (A3, 느슨한 검사)', () => {
  test('어울리는 상대를 성향·분위기로 기술하라는 지시를 담고 있다 ("성향" 키워드 존재)', () => {
    const prompt = buildAnalysisPrompt();
    assert.ok(
      prompt.includes('성향'),
      `프롬프트에 "성향" 관련 지시가 보이지 않는다:\n${prompt}`
    );
  });

  test('외모의 우열·등급을 매기지 말라는 지시를 담고 있다 ("외모" 키워드 존재)', () => {
    const prompt = buildAnalysisPrompt();
    assert.ok(
      prompt.includes('외모'),
      `프롬프트에 "외모" 관련 가드레일이 보이지 않는다:\n${prompt}`
    );
  });
});
