import type { AnalyzeErrorCode } from './types';

const MESSAGES: Record<AnalyzeErrorCode, string> = {
  NO_IMAGE: '이미지가 첨부되지 않았습니다. 사진을 선택한 뒤 다시 시도해 주세요.',
  BAD_IMAGE_FORMAT:
    '지원하지 않는 이미지 형식입니다. JPG, PNG, WEBP 형식의 사진으로 다시 시도해 주세요.',
  IMAGE_TOO_LARGE: '이미지 용량이 너무 큽니다. 4MB 이하의 사진으로 다시 시도해 주세요.',
  NO_API_KEY: '서버에 API 키가 설정되지 않았습니다. 관리자에게 문의해 주세요.',
  INVALID_API_KEY: 'API 키가 유효하지 않습니다. 관리자에게 문의해 주세요.',
  NO_FACE: '정면 얼굴이 잘 보이는 사진으로 다시 시도해 주세요.',
  UPSTREAM_FAILED: '분석 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
  UNPARSABLE_RESPONSE: '분석 결과를 해석하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  TIMEOUT: '분석이 시간 내에 끝나지 않았습니다. 잠시 후 다시 시도해 주세요.',
  RATE_LIMITED:
    '요청이 몰려 잠시 제한되었습니다. 30초쯤 뒤에 다시 시도해 주세요.',
  UPSTREAM_BUSY:
    'AI 서버가 혼잡합니다. 잠시 후 다시 시도해 주세요.',
  SAFETY_BLOCKED:
    '이 사진으로는 분석 결과를 만들지 못했습니다. 얼굴이 정면으로 또렷하게 나온 다른 사진으로 시도해 주세요.',
};

const STATUSES: Record<AnalyzeErrorCode, number> = {
  NO_IMAGE: 400,
  BAD_IMAGE_FORMAT: 400,
  IMAGE_TOO_LARGE: 413,
  NO_API_KEY: 500,
  INVALID_API_KEY: 500,
  NO_FACE: 422,
  UPSTREAM_FAILED: 502,
  UNPARSABLE_RESPONSE: 502,
  TIMEOUT: 504,
  RATE_LIMITED: 429,
  UPSTREAM_BUSY: 503,
  SAFETY_BLOCKED: 422,
};

export function messageForCode(code: AnalyzeErrorCode): string {
  return MESSAGES[code];
}

export function statusForCode(code: AnalyzeErrorCode): number {
  return STATUSES[code];
}

/**
 * 업스트림(Gemini) 호출에서 발생한 임의의 예외를 오류 코드로 분류한다. 절대 던지지 않는다.
 *
 * SDK는 HTTP 상태를 예외 메시지에 `[429 Too Many Requests] ...` 형태로 실어 보낸다.
 * 그래서 상태 코드와 키워드를 함께 본다.
 */
export function classifyUpstreamError(e: unknown): AnalyzeErrorCode {
  const name = (e as { name?: unknown } | null | undefined)?.name;
  const rawMessage = (e as { message?: unknown } | null | undefined)?.message;
  const message = typeof rawMessage === 'string' ? rawMessage : '';

  if (name === 'SafetyBlockedError') return 'SAFETY_BLOCKED';
  if (name === 'AbortError' || name === 'TimeoutError') return 'TIMEOUT';

  if (/timeout|timed out|ETIMEDOUT/i.test(message)) return 'TIMEOUT';

  // API 키 문제는 재시도해도 소용없으므로 먼저 걸러낸다.
  // 400은 키 문제 외의 원인도 많아 포함하지 않는다 — 엉뚱하게 "키가 잘못됐다"고 안내하게 된다.
  if (
    message.includes('API key') ||
    message.includes('API_KEY_INVALID') ||
    /\[401\b/.test(message) ||
    /\[403\b/.test(message)
  ) {
    return 'INVALID_API_KEY';
  }

  if (/\[429\b/.test(message) || /RESOURCE_EXHAUSTED|too many requests|quota/i.test(message)) {
    return 'RATE_LIMITED';
  }

  if (/\[50[034]\b/.test(message) || /overloaded|unavailable|UNAVAILABLE/i.test(message)) {
    return 'UPSTREAM_BUSY';
  }

  if (/SAFETY|blocked/i.test(message)) return 'SAFETY_BLOCKED';

  return 'UPSTREAM_FAILED';
}

/**
 * 같은 요청을 다시 보내면 성공할 가능성이 있는 오류인가.
 *
 * 재시도가 **무의미하거나 해로운** 것은 제외한다:
 * 잘못된 API 키(영영 실패), 안전 필터 차단(같은 사진이면 또 막힘),
 * 입력 검증 오류(사용자가 고쳐야 함).
 */
export function isRetryableCode(code: AnalyzeErrorCode): boolean {
  return (
    code === 'RATE_LIMITED' ||
    code === 'UPSTREAM_BUSY' ||
    code === 'UPSTREAM_FAILED' ||
    // 형식이 어긋난 응답은 다시 뽑으면 대개 성공한다.
    code === 'UNPARSABLE_RESPONSE'
  );
}

export function toErrorResponse(code: AnalyzeErrorCode): {
  body: { ok: false; code: AnalyzeErrorCode; message: string };
  status: number;
} {
  return {
    body: { ok: false, code, message: messageForCode(code) },
    status: statusForCode(code),
  };
}
