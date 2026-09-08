/**
 * lib/prompt.ts — buildAnalysisPrompt() 계약 검증.
 * 대응 수락 기준: A3
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalysisPrompt } from '../lib/prompt';

// 프롬프트가 모델에게 요구해야 하는 JSON 스키마 키 이름들.
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
    test(`JSON 스키마 키 "${key}" 를 문자 그대로 포함한다`, () => {
      const prompt = buildAnalysisPrompt();
      assert.ok(
        prompt.includes(key),
        `프롬프트에 키 "${key}" 가 없다:\n${prompt}`
      );
    });
  }

  for (const el of REQUIRED_ELEMENTS) {
    test(`오행 "${el}" 을 포함한다`, () => {
      const prompt = buildAnalysisPrompt();
      assert.ok(
        prompt.includes(el),
        `프롬프트에 오행 "${el}" 이 없다:\n${prompt}`
      );
    });
  }
});
