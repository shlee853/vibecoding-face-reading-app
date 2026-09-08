import { GoogleGenerativeAI } from '@google/generative-ai';
import { buildAnalysisPrompt } from './prompt';
import { parseAnalysis } from './parse';
import type { ParseResult, VisionClient } from './types';

const MODEL_NAME = 'gemini-3.6-flash';

/** 실제 Gemini API에 연결된 VisionClient를 만든다. 절대 테스트에서 호출하지 않는다. */
export function createGeminiClient(apiKey: string): VisionClient {
  const genAI = new GoogleGenerativeAI(apiKey);

  return {
    async generate(input) {
      const model = genAI.getGenerativeModel({ model: MODEL_NAME });
      const response = await model.generateContent([
        {
          inlineData: {
            data: input.base64,
            mimeType: input.mimeType,
          },
        },
        input.prompt,
      ]);
      return response.response.text();
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
