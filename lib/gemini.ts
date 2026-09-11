import { GoogleGenerativeAI } from '@google/generative-ai';
import { buildFacePrompt, buildFortunePrompt } from './prompt';
import { extractJsonBlock, parseAnalysisValue } from './parse';
import type { ParseResult, VisionClient } from './types';

const MODEL_NAME = 'gemini-3.6-flash';

/** 출력 상한. 넘으면 JSON이 잘려 파싱에 실패하므로 여유를 두되 무한정 두지 않는다. */
const MAX_OUTPUT_TOKENS = 3072;

/**
 * 응답을 기다리는 상한.
 *
 * 25초로 뒀다가 정상 분석까지 잘라버렸다 — Gemini 비전 호출은 부하에 따라 편차가 크고
 * 관측된 값만 해도 15.9초였다. 상한은 "비정상을 끊는" 값이어야지 "정상을 자르는" 값이면 안 된다.
 */
const REQUEST_TIMEOUT_MS = 90_000;

class SafetyBlockedError extends Error {
  constructor(detail: string) {
    super(`Gemini blocked the response (${detail})`);
    this.name = 'SafetyBlockedError';
  }
}

class UpstreamTimeoutError extends Error {
  constructor(ms: number) {
    super(`Gemini did not respond within ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new UpstreamTimeoutError(ms)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/** 실제 Gemini API에 연결된 VisionClient를 만든다. 절대 테스트에서 호출하지 않는다. */
export function createGeminiClient(apiKey: string): VisionClient {
  const genAI = new GoogleGenerativeAI(apiKey);

  return {
    async generate(input) {
      const model = genAI.getGenerativeModel({
        model: MODEL_NAME,
        generationConfig: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          // 형식을 지켜야 하는 작업이라 창의성보다 일관성을 택한다.
          temperature: 0.7,
        },
      });

      const result = await withTimeout(
        model.generateContent([
          { inlineData: { data: input.base64, mimeType: input.mimeType } },
          input.prompt,
        ]),
        REQUEST_TIMEOUT_MS
      );

      const response = result.response;

      // 프롬프트 자체가 막힌 경우 — text()는 의미 없는 예외를 던지므로 먼저 걸러 이름을 붙인다.
      const blockReason = response.promptFeedback?.blockReason;
      if (blockReason) {
        throw new SafetyBlockedError(`promptFeedback=${blockReason}`);
      }

      const finishReason = response.candidates?.[0]?.finishReason;
      if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
        throw new SafetyBlockedError(`finishReason=${finishReason}`);
      }

      const text = response.text();

      // 출력 상한에 걸려 잘렸으면 JSON이 깨진다. 파서에게 넘기지 말고 여기서 드러낸다.
      if (finishReason === 'MAX_TOKENS') {
        throw new Error(`Gemini response truncated at maxOutputTokens (${MAX_OUTPUT_TOKENS})`);
      }

      return text;
    },
  };
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** 응답이 "얼굴을 못 찾았다"고 말하고 있으면 그 사유를 돌려준다. */
function noFaceReason(value: unknown): string | null {
  const obj = asObject(value);
  if (!obj || obj.faceDetected !== false) return null;
  const reason = obj.reason;
  return typeof reason === 'string' && reason.trim().length > 0
    ? reason
    : '사진에서 얼굴을 인식할 수 없습니다. 정면이 잘 보이는 밝은 사진으로 다시 시도해 주세요.';
}

/**
 * 얼굴 사진을 분석한다.
 *
 * **관상 파트와 운세 파트를 동시에(병렬) 생성한 뒤 두 결과를 합친다.**
 * 한 번에 전부 생성하면 출력 토큰이 그대로 지연이 되어, 내용을 충실히 할수록 느려진다.
 * 절반씩 동시에 만들면 같은 시간에 두 배 분량을 얻는다 — 대신 이미지를 두 번 보내므로
 * API 호출 비용은 두 배가 된다.
 *
 * 업스트림 예외는 잡지 않고 그대로 던진다 — 분류는 호출자(API 라우트)의 책임이다.
 * 둘 중 하나만 실패해도 Promise.all이 그 예외를 던진다.
 */
export async function analyzeFace(
  input: { base64: string; mimeType: string },
  client: VisionClient
): Promise<{ parsed: ParseResult; elapsedMs: number }> {
  const startedAt = Date.now();

  const [faceRaw, fortuneRaw] = await Promise.all([
    client.generate({
      base64: input.base64,
      mimeType: input.mimeType,
      prompt: buildFacePrompt(),
    }),
    client.generate({
      base64: input.base64,
      mimeType: input.mimeType,
      prompt: buildFortunePrompt(),
    }),
  ]);

  const elapsedMs = Date.now() - startedAt;

  const faceValue = extractJsonBlock(faceRaw);
  const fortuneValue = extractJsonBlock(fortuneRaw);

  // 어느 쪽이든 얼굴이 없다고 하면 그 판정을 따른다.
  // 한쪽만 보고 진행하면 "얼굴 없는 사진에 운세만 붙은" 결과가 나온다.
  const reason = noFaceReason(faceValue) ?? noFaceReason(fortuneValue);
  if (reason) {
    return { parsed: { kind: 'noface', reason }, elapsedMs };
  }

  // 두 응답을 합쳐 단일 호출 때와 **동일한 기준**으로 검증한다.
  const merged = { ...(asObject(faceValue) ?? {}), ...(asObject(fortuneValue) ?? {}) };
  const parsed = parseAnalysisValue(merged, `${faceRaw}\n--- 운세 파트 ---\n${fortuneRaw}`);

  return { parsed, elapsedMs };
}
