import { buildFacePrompt, buildFortunePrompt } from './prompt';
import { extractJsonBlock, parseAnalysisValue } from './parse';
import { classifyUpstreamError, isRetryableCode } from './errors';

/** 어느 파트가 몇 번째 시도에서 왜 실패했는지 호출자가 기록할 수 있게 한다. */
export interface AnalyzeOptions {
  onAttemptError?: (info: { part: 'face' | 'fortune'; attempt: number; error: unknown }) => void;
  /** 테스트가 실제 대기 없이 재시도 경로를 돌리기 위해 주입한다. */
  sleep?: (ms: number) => Promise<void>;
}
import type { ParseResult, VisionClient } from './types';

/**
 * 두 개의 provider를 쓴다:
 *
 * - **OpenRouter**(기본, 운영 서버): GLM 5.3 Flash 유료 티어(`z-ai/glm-5.3-flash`).
 *   Google Gemini API/Vertex AI는 키 유효성·결재·조직 정책(서비스 계정 키 차단) 문제를
 *   넘지 못해 OpenRouter로 갈아탔다. 처음엔 무료 티어(Gemma 4 26B A4B)를 썼지만 전
 *   세계 사용자가 공유하는 풀이라 rate limit이 반복돼, 결제 기반 유료 모델로 바꿨다.
 *
 * - **Ollama**(로컬 개발 전용): 로컬 반복 테스트 중 OpenRouter 요청을 아끼려고
 *   로컬에서만 `AI_PROVIDER=ollama`로 우회할 수 있게 했다.
 *   **운영 서버에는 절대 쓰지 않는다** — 개인 PC가 24시간 켜져 있어야 하고, 인증 없는
 *   Ollama API를 인터넷에 노출해야 해서 보안·가용성 모두 부적합하다.
 */
export const AI_PROVIDER = (process.env.AI_PROVIDER === 'ollama' ? 'ollama' : 'openrouter') as
  | 'openrouter'
  | 'ollama';

export const MODEL_NAME =
  AI_PROVIDER === 'ollama' ? process.env.OLLAMA_MODEL || 'gemma4:12b' : 'z-ai/glm-5.3-flash';

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

/**
 * 출력 상한.
 *
 * 분량을 크게 늘린 뒤 3072로는 한국어 응답이 잘릴 수 있게 됐다. 잘리면 JSON이 깨져
 * 분석 전체가 실패한다. 상한을 올려도 **실제로 생성한 만큼만 과금**되므로 여유를 둔다.
 */
const MAX_OUTPUT_TOKENS = 8192;

/** 한 파트가 일시적 오류로 실패했을 때 그 파트만 다시 시도하는 횟수 */
const RETRY_PER_PART = 2;

/**
 * 응답을 기다리는 상한.
 *
 * 25초로 뒀다가 정상 분석까지 잘라버렸다 — Gemini 비전 호출은 부하에 따라 편차가 크고
 * 관측된 값만 해도 15.9초였다. 상한은 "비정상을 끊는" 값이어야지 "정상을 자르는" 값이면 안 된다.
 *
 * 로컬 Ollama(gemma4:12b)는 API 호출보다 훨씬 느리다 — CPU/GPU로 직접 추론하므로
 * 관상+운세처럼 긴 JSON 출력은 90초를 넘기기 쉽다(실측: 짧은 인사말도 1.5~17초).
 * 90초는 이 경우 "정상을 자르는" 값이라 5분으로 올린다.
 */
const REQUEST_TIMEOUT_MS = 300_000;

class SafetyBlockedError extends Error {
  constructor(detail: string) {
    super(`Model blocked the response (${detail})`);
    this.name = 'SafetyBlockedError';
  }
}

class UpstreamTimeoutError extends Error {
  constructor(ms: number) {
    super(`Model did not respond within ${ms}ms`);
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

interface OpenRouterResponse {
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  error?: { message?: string; code?: number };
}

interface OllamaChatResponse {
  message?: { content?: string | null };
  done?: boolean;
  done_reason?: string | null;
  error?: string;
}

/** 실제 Vision 모델(OpenRouter 또는 Ollama)에 연결된 VisionClient를 만든다. 절대 테스트에서 호출하지 않는다. */
export function createGeminiClient(apiKey: string): VisionClient {
  return AI_PROVIDER === 'ollama' ? createOllamaClient() : createOpenRouterClient(apiKey);
}

/** 로컬 Ollama(gemma4:12b 등)에 연결된 VisionClient. 인증이 없으므로 apiKey를 받지 않는다. */
function createOllamaClient(): VisionClient {
  return {
    async generate(input) {
      const response = await withTimeout(
        fetch(`${OLLAMA_BASE_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MODEL_NAME,
            messages: [
              {
                role: 'user',
                content: input.prompt,
                // Ollama는 base64 이미지를 문자열 배열로 받는다 (data URL 접두사 없이).
                images: [input.base64],
              },
            ],
            stream: false,
            // gemma4는 기본으로 "thinking"(응답 전 사고 과정)을 생성한다 — 간단한 인사말도
            // 16초 이상 걸리게 만드는 주범이라(로컬 실측: think 켬 16.8초 → 끔 1.5초) 끈다.
            // 이 앱은 형식화된 JSON 출력만 필요하지 추론 과정 자체가 목적이 아니다.
            think: false,
            options: {
              num_predict: MAX_OUTPUT_TOKENS,
              temperature: 0.7,
            },
          }),
        }),
        REQUEST_TIMEOUT_MS
      );

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        throw new Error(`[${response.status}] Ollama error: ${bodyText.slice(0, 500)}`);
      }

      const json = (await response.json()) as OllamaChatResponse;

      if (json.error) {
        throw new Error(`Ollama error: ${json.error}`);
      }

      const text = json.message?.content ?? '';

      if (!text) {
        throw new Error('Ollama returned empty response');
      }

      if (json.done_reason === 'length') {
        throw new Error(`Gemma response truncated at num_predict (${MAX_OUTPUT_TOKENS})`);
      }

      return text;
    },
  };
}

/** 실제 OpenRouter(GLM 5.3 Flash)에 연결된 VisionClient를 만든다. */
function createOpenRouterClient(apiKey: string): VisionClient {
  return {
    async generate(input) {
      const response = await withTimeout(
        fetch(OPENROUTER_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            // OpenRouter가 요청 출처를 식별하는 데 쓴다 (필수는 아니지만 권장됨).
            // ★ HTTP 헤더 값은 Latin-1(ASCII)만 담을 수 있다 — 한글을 넣으면
            //   "Cannot convert argument to a ByteString"으로 모든 요청이 즉시 실패한다.
            //   (lib/apikey.ts가 API 키에서 막던 바로 그 문제를 여기서 저질렀었다.)
            'HTTP-Referer': 'https://168-107-8-13.sslip.io',
            'X-Title': 'Face Reading App',
          },
          body: JSON.stringify({
            model: MODEL_NAME,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image_url',
                    image_url: { url: `data:${input.mimeType};base64,${input.base64}` },
                  },
                  { type: 'text', text: input.prompt },
                ],
              },
            ],
            max_tokens: MAX_OUTPUT_TOKENS,
            // 형식을 지켜야 하는 작업이라 창의성보다 일관성을 택한다.
            temperature: 0.7,
          }),
        }),
        REQUEST_TIMEOUT_MS
      );

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        // classifyUpstreamError는 메시지 안의 "[상태코드"를 보고 분류한다 — 형식을 맞춘다.
        throw new Error(`[${response.status}] OpenRouter error: ${bodyText.slice(0, 500)}`);
      }

      const json = (await response.json()) as OpenRouterResponse;

      if (json.error) {
        throw new Error(`[${json.error.code ?? 'unknown'}] OpenRouter error: ${json.error.message}`);
      }

      const choice = json.choices?.[0];
      const finishReason = choice?.finish_reason;

      if (finishReason === 'content_filter') {
        throw new SafetyBlockedError(`finish_reason=${finishReason}`);
      }

      const text = choice?.message?.content ?? '';

      if (!text) {
        throw new Error('OpenRouter returned empty response');
      }

      // 출력 상한에 걸려 잘렸으면 JSON이 깨진다. 파서에게 넘기지 말고 여기서 드러낸다.
      if (finishReason === 'length') {
        throw new Error(`Gemma response truncated at max_tokens (${MAX_OUTPUT_TOKENS})`);
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
  client: VisionClient,
  options: AnalyzeOptions = {}
): Promise<{ parsed: ParseResult; elapsedMs: number }> {
  const startedAt = Date.now();
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const parts = [
    { name: 'face' as const, prompt: buildFacePrompt() },
    { name: 'fortune' as const, prompt: buildFortunePrompt() },
  ];

  const call = (prompt: string) =>
    client.generate({ base64: input.base64, mimeType: input.mimeType, prompt });

  // 1차는 병렬 — 두 파트를 동시에 생성해 벽시계 시간을 아낀다.
  const settled = await Promise.allSettled(parts.map((p) => call(p.prompt)));

  const raws: (string | null)[] = settled.map((s) => (s.status === 'fulfilled' ? s.value : null));
  const errors: unknown[] = settled.map((s) => (s.status === 'rejected' ? s.reason : null));

  settled.forEach((s, i) => {
    if (s.status === 'rejected') {
      options.onAttemptError?.({ part: parts[i].name, attempt: 1, error: s.reason });
    }
  });

  // 2차부터는 **실패한 파트만, 순차로** 다시 시도한다.
  // 성공한 파트를 버리지 않으니 비용이 절반이고, 동시 요청을 줄이므로
  // 업스트림 혼잡(503)이 원인이었던 경우 풀릴 가능성이 높아진다.
  for (let i = 0; i < parts.length; i++) {
    for (let attempt = 2; raws[i] === null && attempt <= RETRY_PER_PART + 1; attempt++) {
      const code = classifyUpstreamError(errors[i]);
      if (!isRetryableCode(code)) break;

      // RATE_LIMITED는 다른 업스트림 혼잡보다 훨씬 오래(수 초~수십 초) 걸려야 풀리는
      // 경우가 흔하다. 지터를 섞어 재시도가 서로 겹치지 않게 한다.
      const baseMs = code === 'RATE_LIMITED' ? 5000 : 900;
      await sleep(baseMs * (attempt - 1) + Math.floor(Math.random() * 400));

      try {
        raws[i] = await call(parts[i].prompt);
        errors[i] = null;
      } catch (e) {
        errors[i] = e;
        options.onAttemptError?.({ part: parts[i].name, attempt, error: e });
      }
    }
  }

  const failed = errors.find((e) => e !== null && e !== undefined);
  if (failed !== undefined) throw failed;

  const [faceRaw, fortuneRaw] = raws as [string, string];
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
