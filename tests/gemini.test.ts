/**
 * lib/gemini.ts — analyzeFace() 계약 검증. createGeminiClient()는 import만 하고
 * 절대 호출하지 않는다 (호출하면 실제 유료 Gemini API로 이어진다 — 안전경계 위반).
 * 대응 수락 기준: A7 (회귀). 스프린트 3: 픽스처에 love 필드를 추가해 ok 판정이
 * 여전히 ok로 유지되는지 확인한다 (love가 필수가 됐으므로 빠지면 unparsable로 뒤집힌다).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFace, createGeminiClient } from '../lib/gemini';
import type { VisionClient } from '../lib/types';

type RecordedCall = { base64: string; mimeType: string; prompt: string };

/** 네트워크를 전혀 타지 않는 가짜 VisionClient. 호출 인자를 기록해 검증에 쓴다. */
function makeFakeClient(behavior: { response: string } | { throws: unknown }): {
  client: VisionClient;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const client: VisionClient = {
    async generate(input) {
      calls.push(input);
      if ('throws' in behavior) {
        throw behavior.throws;
      }
      return behavior.response;
    },
  };
  return { client, calls };
}

const SAMPLE_INPUT = { base64: 'ZmFrZS1pbWFnZS1ieXRlcw==', mimeType: 'image/jpeg' };

const VALID_READING_JSON = JSON.stringify({
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
    strengths: ['책임감이 강함'],
    weaknesses: ['결정이 느릴 때가 있음'],
    social: '낯을 가리지만 친해지면 깊은 관계를 맺는 편입니다.',
  },
  saju: {
    element: '목',
    elementReason: '이마와 눈매의 기운이 나무의 상승하는 기운과 닮아 목의 기운이 강합니다.',
    fortune: '올해는 새로운 시작과 성장의 기운이 강한 해입니다.',
    advice: '무리한 확장보다는 기초를 다지는 데 집중하세요.',
  },
  love: {
    idealPartner: {
      type: '차분하게 대화를 이끌어가는 사람',
      traits: ['배려심이 많음', '유머 감각이 있음'],
      reason: '눈매가 부드럽고 입꼬리가 편안하게 올라가 있어 정서적으로 안정된 상대와 잘 맞습니다.',
    },
    romance: {
      tendency: '표현이 서툴지만 한 번 마음을 열면 오래도록 다정하게 챙기는 편입니다.',
      fortune: '하반기에 새로운 인연이 자연스럽게 다가올 기운이 보입니다.',
      caution: '상대의 작은 신호를 놓치지 않도록 평소보다 관심을 기울이세요.',
    },
  },
});

const NOFACE_JSON = JSON.stringify({
  faceDetected: false,
  reason: '사진에서 얼굴을 인식할 수 없습니다.',
});

describe('analyzeFace — 세 가지 경로 (A7, 회귀)', () => {
  test('ok 경로: 가짜 클라이언트가 유효한 JSON(love 포함)을 반환하면 parsed.kind === "ok"', async () => {
    const { client } = makeFakeClient({ response: VALID_READING_JSON });
    const { parsed } = await analyzeFace(SAMPLE_INPUT, client);
    assert.equal(parsed.kind, 'ok');
  });

  test('noface 경로: faceDetected:false 응답이면 parsed.kind === "noface"', async () => {
    const { client } = makeFakeClient({ response: NOFACE_JSON });
    const { parsed } = await analyzeFace(SAMPLE_INPUT, client);
    assert.equal(parsed.kind, 'noface');
  });

  test('unparsable 경로: JSON이 없는 산문 응답이면 parsed.kind === "unparsable"', async () => {
    const { client } = makeFakeClient({ response: '죄송합니다, 처리할 수 없습니다.' });
    const { parsed } = await analyzeFace(SAMPLE_INPUT, client);
    assert.equal(parsed.kind, 'unparsable');
  });

  test('unparsable 경로: love가 빠진 JSON은 (features/personality/saju가 온전해도) unparsable', async () => {
    const withoutLove = JSON.parse(VALID_READING_JSON);
    delete withoutLove.love;
    const { client } = makeFakeClient({ response: JSON.stringify(withoutLove) });
    const { parsed } = await analyzeFace(SAMPLE_INPUT, client);
    assert.equal(parsed.kind, 'unparsable');
  });

  test('elapsedMs는 음수가 아닌 숫자다 (ok 경로)', async () => {
    const { client } = makeFakeClient({ response: VALID_READING_JSON });
    const { elapsedMs } = await analyzeFace(SAMPLE_INPUT, client);
    assert.equal(typeof elapsedMs, 'number');
    assert.ok(Number.isFinite(elapsedMs));
    assert.ok(elapsedMs >= 0, `elapsedMs가 음수: ${elapsedMs}`);
  });

  test('elapsedMs는 음수가 아닌 숫자다 (noface 경로)', async () => {
    const { client } = makeFakeClient({ response: NOFACE_JSON });
    const { elapsedMs } = await analyzeFace(SAMPLE_INPUT, client);
    assert.equal(typeof elapsedMs, 'number');
    assert.ok(elapsedMs >= 0, `elapsedMs가 음수: ${elapsedMs}`);
  });

  test('elapsedMs는 음수가 아닌 숫자다 (unparsable 경로)', async () => {
    const { client } = makeFakeClient({ response: '알 수 없는 응답' });
    const { elapsedMs } = await analyzeFace(SAMPLE_INPUT, client);
    assert.equal(typeof elapsedMs, 'number');
    assert.ok(elapsedMs >= 0, `elapsedMs가 음수: ${elapsedMs}`);
  });
});

describe('analyzeFace — 업스트림 예외 전파 (회귀)', () => {
  test('client.generate가 던진 예외는 삼켜지지 않고 그대로 전파된다', async () => {
    const boom = new Error('네트워크 오류: 연결 실패');
    const { client } = makeFakeClient({ throws: boom });
    await assert.rejects(() => analyzeFace(SAMPLE_INPUT, client), (err: unknown) => {
      assert.equal(err, boom, '던져진 에러 객체가 그대로 전파되어야 한다 (감싸거나 삼키면 안 됨)');
      return true;
    });
  });

  test('client.generate가 AbortError를 던지면 그 형태 그대로 전파된다', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    const { client } = makeFakeClient({ throws: abortErr });
    await assert.rejects(() => analyzeFace(SAMPLE_INPUT, client), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal((err as Error).name, 'AbortError');
      return true;
    });
  });
});

describe('analyzeFace — 관상·운세 두 파트를 병렬 호출한다', () => {
  test('generate가 정확히 두 번, 같은 이미지와 함께 호출된다', async () => {
    const { client, calls } = makeFakeClient({ response: VALID_READING_JSON });
    await analyzeFace(SAMPLE_INPUT, client);

    assert.equal(calls.length, 2, '관상 파트와 운세 파트로 두 번 호출되어야 한다');
    for (const call of calls) {
      assert.equal(call.base64, SAMPLE_INPUT.base64, '두 호출 모두 같은 이미지를 받아야 한다');
      assert.equal(call.mimeType, SAMPLE_INPUT.mimeType);
    }
  });

  test('두 호출에 서로 다른 프롬프트가 전달된다 — 같으면 나눈 의미가 없다', async () => {
    const { client, calls } = makeFakeClient({ response: VALID_READING_JSON });
    await analyzeFace(SAMPLE_INPUT, client);

    const [a, b] = calls.map((c) => c.prompt);
    assert.ok(a.trim().length > 0 && b.trim().length > 0, '프롬프트가 비어있다');
    assert.notEqual(a, b, '두 호출이 같은 프롬프트를 쓰면 분할이 무의미하다');
  });

  test('두 프롬프트를 합치면 필요한 스키마가 모두 요구된다', async () => {
    const { client, calls } = makeFakeClient({ response: VALID_READING_JSON });
    await analyzeFace(SAMPLE_INPUT, client);

    const combined = calls.map((c) => c.prompt).join('\n');
    for (const key of ['faceDetected', 'features', 'personality', 'saju', 'love']) {
      assert.ok(combined.includes(key), `어느 프롬프트에도 "${key}" 가 없다`);
    }
  });

  test('한쪽 호출이 실패하면 전체가 실패한다 — 반쪽 결과를 내보내지 않는다', async () => {
    let n = 0;
    const client = {
      async generate() {
        n += 1;
        if (n === 2) throw new Error('두 번째 파트 실패');
        return VALID_READING_JSON;
      },
    };

    await assert.rejects(() => analyzeFace(SAMPLE_INPUT, client), /두 번째 파트 실패/);
  });
});

describe('analyzeFace — 두 응답을 합쳐 단일 호출과 같은 기준으로 검증한다', () => {
  test('한쪽에만 얼굴 없음이 오면 noface로 판정한다', async () => {
    let n = 0;
    const client = {
      async generate() {
        n += 1;
        return n === 1
          ? JSON.stringify({ faceDetected: false, reason: '얼굴이 가려져 있습니다' })
          : VALID_READING_JSON;
      },
    };

    const { parsed } = await analyzeFace(SAMPLE_INPUT, client);
    assert.equal(parsed.kind, 'noface');
    if (parsed.kind === 'noface') {
      assert.match(parsed.reason, /가려/);
    }
  });

  test('두 파트가 각자 절반씩만 주어도 합치면 ok가 된다', async () => {
    const full = JSON.parse(VALID_READING_JSON) as Record<string, unknown>;
    const facePart = {
      faceDetected: true,
      features: full.features,
      personality: full.personality,
    };
    const fortunePart = { faceDetected: true, saju: full.saju, love: full.love };

    let n = 0;
    const client = {
      async generate() {
        n += 1;
        return JSON.stringify(n === 1 ? facePart : fortunePart);
      },
    };

    const { parsed } = await analyzeFace(SAMPLE_INPUT, client);
    assert.equal(parsed.kind, 'ok', '두 반쪽을 합치면 완전한 결과가 되어야 한다');
  });

  test('한쪽이 통째로 빠지면 unparsable — 기준을 느슨하게 하지 않는다', async () => {
    const full = JSON.parse(VALID_READING_JSON) as Record<string, unknown>;
    const facePart = {
      faceDetected: true,
      features: full.features,
      personality: full.personality,
    };

    let n = 0;
    const client = {
      async generate() {
        n += 1;
        // 운세 파트가 형식을 지키지 못한 상황
        return n === 1 ? JSON.stringify(facePart) : '죄송합니다, 분석할 수 없습니다.';
      },
    };

    const { parsed } = await analyzeFace(SAMPLE_INPUT, client);
    assert.equal(parsed.kind, 'unparsable', 'saju·love가 없으면 통과시키면 안 된다');
  });
});

describe('createGeminiClient — 존재만 확인, 절대 호출하지 않음', () => {
  test('createGeminiClient는 함수로 export되어 있다 (호출은 하지 않는다 — 유료 API 위험)', () => {
    assert.equal(typeof createGeminiClient, 'function');
  });
});
