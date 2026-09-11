import { GoogleGenerativeAI } from '@google/generative-ai';
import { buildAnalysisPrompt } from './prompt';
import { parseAnalysis } from './parse';
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

/**
 * 얼굴 사진을 분석한다. 프롬프트를 구성해 클라이언트에 넘기고, 받은 텍스트를 파싱한다.
 * 업스트림 예외는 잡지 않고 그대로 던진다 — 분류는 호출자(API 라우트)의 책임이다.
 */
export async function analyzeFace(
  input: { base64: string; mimeType: string },
  client: VisionClient
): Promise<{ parsed: ParseResult; elapsedMs: number }> {
  const prompt = buildAnalysisPrompt();

  const startedAt = Date.now();
  const raw = await client.generate({
    base64: input.base64,
    mimeType: input.mimeType,
    prompt,
  });
  const elapsedMs = Date.now() - startedAt;

  const parsed = parseAnalysis(raw);

  return { parsed, elapsedMs };
}
