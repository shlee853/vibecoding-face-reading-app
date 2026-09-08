/**
 * lib/parse.ts — extractJsonBlock() / parseAnalysis() 계약 검증.
 * 대응 수락 기준: A2, A4 (+ extractJsonBlock 자체 회수 능력)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonBlock, parseAnalysis } from '../lib/parse';
import { ELEMENTS } from '../lib/types';

// ---- 현실적인 정상 응답 샘플 ------------------------------------------------

const VALID_READING = {
  faceDetected: true,
  features: {
    forehead: '이마가 넓고 둥글어 지혜롭고 포용력 있는 인상입니다.',
    eyes: '눈매가 또렷하고 눈빛이 안정적이어서 신뢰감을 줍니다.',
    nose: '콧대가 곧고 코끝이 둥글어 재물운이 좋은 편입니다.',
    mouth: '입꼬리가 살짝 올라가 있어 사교적인 인상을 줍니다.',
    chin: '턱선이 둥글고 안정적이어서 말년운이 좋습니다.',
  },
  personality: {
    summary: '차분하고 신중하며 주변 사람을 잘 챙기는 성격입니다.',
    strengths: ['책임감이 강함', '포용력이 있음'],
    weaknesses: ['결정이 느릴 때가 있음'],
    social: '낯을 가리지만 친해지면 깊은 관계를 맺는 편입니다.',
  },
  saju: {
    element: '목',
    elementReason: '이마와 눈매의 기운이 나무의 상승하는 기운과 닮아 목의 기운이 강합니다.',
    fortune: '올해는 새로운 시작과 성장의 기운이 강한 해입니다.',
    advice: '무리한 확장보다는 기초를 다지는 데 집중하세요.',
  },
};

function validJson(): string {
  return JSON.stringify(VALID_READING);
}

function fenced(body: string, lang = 'json'): string {
  return '```' + lang + '\n' + body + '\n```';
}

// ---- extractJsonBlock -------------------------------------------------------

describe('extractJsonBlock', () => {
  test('```json 펜스에서 JSON 객체를 회수한다', () => {
    const raw = fenced(validJson(), 'json');
    const result = extractJsonBlock(raw);
    assert.deepEqual(result, VALID_READING);
  });

  test('언어 태그 없는 일반 펜스에서도 회수한다', () => {
    const raw = fenced(validJson(), '');
    const result = extractJsonBlock(raw);
    assert.deepEqual(result, VALID_READING);
  });

  test('펜스 없는 raw JSON을 그대로 회수한다', () => {
    const result = extractJsonBlock(validJson());
    assert.deepEqual(result, VALID_READING);
  });

  test('산문에 둘러싸인 JSON을 회수한다', () => {
    const raw = `분석 결과를 아래 JSON으로 드립니다.\n\n${validJson()}\n\n감사합니다.`;
    const result = extractJsonBlock(raw);
    assert.deepEqual(result, VALID_READING);
  });

  test('문자열 리터럴 안의 중괄호에 속지 않고 바깥 경계를 정확히 자른다', () => {
    const obj = { a: '텍스트 { 여는 중괄호 } 포함', b: 1 };
    const raw = `앞 문장입니다. ${JSON.stringify(obj)} 뒷 문장입니다.`;
    const result = extractJsonBlock(raw);
    assert.deepEqual(result, obj);
  });

  test('JSON이 전혀 없으면 null을 반환한다', () => {
    const result = extractJsonBlock('그냥 평범한 한국어 문장입니다. JSON이 없습니다.');
    assert.equal(result, null);
  });

  test('중괄호가 깨진(닫히지 않은) 텍스트는 null을 반환한다', () => {
    const result = extractJsonBlock('{"a": 1, "b": 2');
    assert.equal(result, null);
  });

  test('빈 문자열은 null을 반환한다', () => {
    const result = extractJsonBlock('');
    assert.equal(result, null);
  });
});

// ---- parseAnalysis: A4 5가지 입력 분기 --------------------------------------

describe('parseAnalysis — 입력 형태별 분기 (A4)', () => {
  test('(1) ```json 펜스 정상 입력 → ok', () => {
    const result = parseAnalysis(fenced(validJson()));
    assert.equal(result.kind, 'ok');
  });

  test('(2) 펜스 없는 raw JSON → ok', () => {
    const result = parseAnalysis(validJson());
    assert.equal(result.kind, 'ok');
  });

  test('(3) 산문에 둘러싸인 JSON → ok', () => {
    const raw = `안녕하세요, 분석 결과입니다:\n${validJson()}\n이상입니다.`;
    const result = parseAnalysis(raw);
    assert.equal(result.kind, 'ok');
  });

  test('(4) faceDetected:false + reason 포함 → noface, reason 그대로 보존', () => {
    const raw = JSON.stringify({ faceDetected: false, reason: '사진에서 얼굴을 찾을 수 없습니다.' });
    const result = parseAnalysis(raw);
    assert.equal(result.kind, 'noface');
    if (result.kind === 'noface') {
      assert.equal(result.reason, '사진에서 얼굴을 찾을 수 없습니다.');
    }
  });

  test('(4-경계) faceDetected:false + reason 필드 없음 → noface, reason은 빈 문자열이 아닌 기본 문구', () => {
    const raw = JSON.stringify({ faceDetected: false });
    const result = parseAnalysis(raw);
    assert.equal(result.kind, 'noface');
    if (result.kind === 'noface') {
      assert.equal(typeof result.reason, 'string');
      assert.ok(result.reason.length > 0, 'reason이 빈 문자열이면 안 된다');
    }
  });

  test('(5) JSON이 전혀 없는 산문 → unparsable, raw 원문 보존', () => {
    const raw = '죄송합니다, 이 요청을 처리할 수 없습니다.';
    const result = parseAnalysis(raw);
    assert.equal(result.kind, 'unparsable');
    if (result.kind === 'unparsable') {
      assert.equal(result.raw, raw);
    }
  });
});

// ---- parseAnalysis: A2 값 채움 검증 (필드 존재가 아니라 값까지) ----------------

describe('parseAnalysis — saju 필드 값 검증 (A2)', () => {
  test('정상 샘플 파싱 시 saju의 네 필드가 입력값 그대로, 비어있지 않게 채워진다', () => {
    const result = parseAnalysis(validJson());
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;

    const { saju } = result.reading;

    // 필드 존재만 확인하면 구현이 빈 문자열을 채워도 통과하므로, 정확한 값까지 비교한다.
    assert.equal(saju.element, VALID_READING.saju.element);
    assert.equal(saju.elementReason, VALID_READING.saju.elementReason);
    assert.equal(saju.fortune, VALID_READING.saju.fortune);
    assert.equal(saju.advice, VALID_READING.saju.advice);

    assert.ok(saju.elementReason.trim().length > 0);
    assert.ok(saju.fortune.trim().length > 0);
    assert.ok(saju.advice.trim().length > 0);
  });

  test('features/personality도 입력값 그대로 보존된다 (스모크)', () => {
    const result = parseAnalysis(validJson());
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.deepEqual(result.reading.features, VALID_READING.features);
    assert.equal(result.reading.personality.summary, VALID_READING.personality.summary);
  });
});

// ---- parseAnalysis: 관용성(레니언시) 규칙 -----------------------------------

describe('parseAnalysis — 관용적 정규화 규칙', () => {
  test('strengths가 배열이 아니라 문자열 하나로 오면 길이 1인 배열로 감싼다', () => {
    const obj = {
      ...VALID_READING,
      personality: { ...VALID_READING.personality, strengths: '책임감이 강함' },
    };
    const result = parseAnalysis(JSON.stringify(obj));
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.deepEqual(result.reading.personality.strengths, ['책임감이 강함']);
  });

  test('weaknesses가 문자열 하나로 오면 길이 1인 배열로 감싼다', () => {
    const obj = {
      ...VALID_READING,
      personality: { ...VALID_READING.personality, weaknesses: '고집이 셀 때가 있음' },
    };
    const result = parseAnalysis(JSON.stringify(obj));
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.deepEqual(result.reading.personality.weaknesses, ['고집이 셀 때가 있음']);
  });

  test('element에 군더더기가 섞여도("목木") 5종 중 하나로 정규화한다', () => {
    const obj = { ...VALID_READING, saju: { ...VALID_READING.saju, element: '목(木)' } };
    const result = parseAnalysis(JSON.stringify(obj));
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.equal(result.reading.saju.element, '목');
    assert.ok((ELEMENTS as readonly string[]).includes(result.reading.saju.element));
  });
});

// ---- parseAnalysis: 유효성 실패 → unparsable --------------------------------

describe('parseAnalysis — 불완전한 구조는 unparsable로 판정한다', () => {
  test('features에 5개 키 중 하나(chin)가 빠지면 unparsable', () => {
    const broken: any = JSON.parse(JSON.stringify(VALID_READING));
    delete broken.features.chin;
    const result = parseAnalysis(JSON.stringify(broken));
    assert.equal(result.kind, 'unparsable');
  });

  test('personality에 4개 키 중 하나(social)가 빠지면 unparsable', () => {
    const broken: any = JSON.parse(JSON.stringify(VALID_READING));
    delete broken.personality.social;
    const result = parseAnalysis(JSON.stringify(broken));
    assert.equal(result.kind, 'unparsable');
  });

  test('saju에 4개 키 중 하나(advice)가 빠지면 unparsable', () => {
    const broken: any = JSON.parse(JSON.stringify(VALID_READING));
    delete broken.saju.advice;
    const result = parseAnalysis(JSON.stringify(broken));
    assert.equal(result.kind, 'unparsable');
  });

  test('문자열 필드가 빈 문자열이면 unparsable (forehead)', () => {
    const broken: any = JSON.parse(JSON.stringify(VALID_READING));
    broken.features.forehead = '';
    const result = parseAnalysis(JSON.stringify(broken));
    assert.equal(result.kind, 'unparsable');
  });

  test('saju.element가 오행 5종 밖의 값이면 unparsable', () => {
    const broken: any = JSON.parse(JSON.stringify(VALID_READING));
    broken.saju.element = '불가능한값';
    const result = parseAnalysis(JSON.stringify(broken));
    assert.equal(result.kind, 'unparsable');
  });
});
