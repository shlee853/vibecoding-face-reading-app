import { NextRequest, NextResponse } from 'next/server';
import { validateImageDataUrl } from '@/lib/image';
import { AI_PROVIDER, createGeminiClient, analyzeFace } from '@/lib/gemini';
import { validateApiKey } from '@/lib/apikey';
import { classifyUpstreamError, isRetryableCode, toErrorResponse } from '@/lib/errors';
import {
  checkRateLimit,
  clientKeyFromHeaders,
  createHitStore,
  sweepHitStore,
  DEFAULT_RULES,
} from '@/lib/ratelimit';
import type { AnalyzeErrorCode, AnalyzeResponseBody } from '@/lib/types';

/**
 * 한 요청 안에서 시도할 최대 횟수.
 *
 * 한 번의 시도가 Gemini를 **두 번**(관상·운세 병렬) 호출하므로, 3회로 두면 최악의 경우
 * 이미지 분석이 6번 청구된다. 2회로 묶어 비용 상한을 분명히 한다.
 */
const MAX_ATTEMPTS = 2;

/**
 * 재시도를 포함해 이 요청에 쓸 수 있는 전체 시간.
 * 재시도가 사용자를 무한정 기다리게 하면 오류보다 나쁜 경험이 된다.
 *
 * lib/gemini.ts의 REQUEST_TIMEOUT_MS(5분, 로컬 Ollama 기준)보다 작으면 1차 시도조차
 * 끝까지 기다리지 못하고 재시도 판단 로직이 무의미해진다 — 최소 1회 완주 + 약간의
 * 재시도 여유를 두고 350초로 맞춘다.
 */
const TOTAL_BUDGET_MS = 350_000;

/**
 * 다음 시도까지 기다리는 시간. 요청량 초과와 업스트림 혼잡은 더 기다려야 풀린다.
 *
 * RATE_LIMITED를 UPSTREAM_BUSY보다 훨씬 길게 잡는다 — 이 앱이 쓰는
 * google/gemma-4-26b-a4b-it:free는 OpenRouter 전체 사용자가 공유하는 무료 풀이라,
 * 혼잡이 몇 초 안에 풀리지 않는 경우가 흔하다.
 */
function backoffMs(attempt: number, code: AnalyzeErrorCode): number {
  if (code === 'RATE_LIMITED') return 8000 * attempt;
  const base = code === 'UPSTREAM_BUSY' ? 2000 : 600;
  return base * attempt;
}

/** 개발 모드에서만 원인 상세를 응답에 싣는다. 프로덕션에서는 내부 사정을 노출하지 않는다. */
const isDev = process.env.NODE_ENV !== 'production';

function describeError(error: unknown): string {
  const name = (error as { name?: string } | null)?.name ?? 'Error';
  const message = (error as { message?: string } | null)?.message ?? String(error);
  const cause = (error as { cause?: { code?: string; message?: string } } | null)?.cause;
  const causeText = cause ? ` | cause: ${cause.code ?? ''} ${cause.message ?? ''}`.trimEnd() : '';
  return `${name}: ${message}${causeText}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 요청 기록은 프로세스 메모리에 둔다 (단일 VM 전제).
 * 모듈 최상위에 두어 요청 간에 유지되게 한다.
 */
const hitStore = createHitStore();
const MAX_RULE_WINDOW_MS = Math.max(...DEFAULT_RULES.map((r) => r.windowMs));
let lastSweepAt = 0;

export async function POST(request: NextRequest): Promise<NextResponse<AnalyzeResponseBody>> {
  const now = Date.now();

  // 가장 먼저 막는다 — 본문(최대 4MB)을 읽기도 전에 걸러야 제한의 의미가 있다.
  const clientKey = clientKeyFromHeaders(request.headers);
  const limit = checkRateLimit(hitStore, clientKey, now);

  // 가끔 오래된 키를 쓸어 메모리가 무한히 자라지 않게 한다.
  if (now - lastSweepAt > 10 * 60_000) {
    lastSweepAt = now;
    sweepHitStore(hitStore, now, MAX_RULE_WINDOW_MS);
  }

  if (!limit.allowed) {
    console.warn(`[analyze] 요청 제한: key=${clientKey} rule=${limit.blockedBy}`);
    const { body, status } = toErrorResponse('TOO_MANY_REQUESTS');
    return NextResponse.json(body, {
      status,
      headers: { 'Retry-After': String(limit.retryAfterSec) },
    });
  }

  let image: unknown;
  try {
    const body = await request.json();
    image = body?.image;
  } catch {
    const { body, status } = toErrorResponse('NO_IMAGE');
    return NextResponse.json(body, { status });
  }

  const validation = validateImageDataUrl(image);
  if (!validation.ok) {
    const { body, status } = toErrorResponse(validation.code);
    return NextResponse.json(body, { status });
  }

  // Ollama(로컬 전용)는 인증이 없으므로 키 검증 자체가 무의미하다.
  let apiKey: string | undefined;
  if (AI_PROVIDER !== 'ollama') {
    // 키 형식을 **부르기 전에** 본다. 헤더에 못 싣는 문자가 섞여 있으면 요청이 만들어지지도
    // 않는데, 그걸 모르고 재시도까지 하면 실패가 뻔한 호출을 네 번 반복하게 된다.
    apiKey = process.env.OPENROUTER_API_KEY;
    const keyCheck = validateApiKey(apiKey);
    if (!keyCheck.ok) {
      console.error(`[analyze] API 키 설정 문제 (${keyCheck.reason}): ${keyCheck.detail}`);
      const { body, status } = toErrorResponse(
        keyCheck.reason === 'missing' ? 'NO_API_KEY' : 'INVALID_API_KEY'
      );
      return NextResponse.json(isDev ? { ...body, detail: keyCheck.detail } : body, { status });
    }
  }

  const client = createGeminiClient(apiKey as string);
  const requestStartedAt = Date.now();
  let lastCode: AnalyzeErrorCode = 'UPSTREAM_FAILED';
  let lastDetail: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { parsed, elapsedMs } = await analyzeFace(
        { base64: validation.base64, mimeType: validation.mimeType },
        client,
        {
          onAttemptError: ({ part, attempt: partAttempt, error }) => {
            console.error(
              `[analyze] ${part} 파트 ${partAttempt}번째 시도 실패: ${describeError(error)}`
            );
          },
        }
      );

      if (parsed.kind === 'ok') {
        return NextResponse.json({ ok: true, result: parsed.reading, elapsedMs }, { status: 200 });
      }

      if (parsed.kind === 'noface') {
        // 얼굴이 없다는 것은 정당한 답이다. 다시 물어봐도 답은 같다.
        const { status } = toErrorResponse('NO_FACE');
        return NextResponse.json({ ok: false, code: 'NO_FACE', message: parsed.reason }, { status });
      }

      lastCode = 'UNPARSABLE_RESPONSE';
      const preview = parsed.raw.slice(0, 300).replace(/\s+/g, ' ');
      lastDetail = `응답이 JSON 계약을 벗어남 (${elapsedMs}ms). 원문 앞부분: ${preview}`;
      console.warn(`[analyze] 시도 ${attempt}/${MAX_ATTEMPTS} 실패: ${lastDetail}`);
    } catch (error) {
      lastCode = classifyUpstreamError(error);
      lastDetail = describeError(error);
      // 실제 원인을 남기지 않으면 사용자가 겪는 오류를 영영 진단할 수 없다.
      // 이미지·API 키는 절대 찍지 않는다.
      console.error(
        `[analyze] 시도 ${attempt}/${MAX_ATTEMPTS} 실패: code=${lastCode} ${lastDetail.slice(0, 400)}`
      );
    }

    if (!isRetryableCode(lastCode)) break;

    const elapsed = Date.now() - requestStartedAt;
    const wait = backoffMs(attempt, lastCode);
    // 남은 예산으로 한 번 더 시도할 수 없으면 지금 멈추는 편이 낫다.
    if (attempt === MAX_ATTEMPTS || elapsed + wait > TOTAL_BUDGET_MS) break;

    await sleep(wait);
  }

  const { body, status } = toErrorResponse(lastCode);
  return NextResponse.json(
    isDev && lastDetail ? { ...body, detail: lastDetail.slice(0, 600) } : body,
    { status }
  );
}
