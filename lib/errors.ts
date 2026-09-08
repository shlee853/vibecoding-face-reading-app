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
};

export function messageForCode(code: AnalyzeErrorCode): string {
  return MESSAGES[code];
}

export function statusForCode(code: AnalyzeErrorCode): number {
  return STATUSES[code];
}

/** 업스트림(Gemini) 호출에서 발생한 임의의 예외를 오류 코드로 분류한다. 절대 던지지 않는다. */
export function classifyUpstreamError(e: unknown): AnalyzeErrorCode {
  const name = (e as { name?: unknown } | null | undefined)?.name;
  const message = (e as { message?: unknown } | null | undefined)?.message;

  if (name === 'AbortError') return 'TIMEOUT';

  if (typeof message === 'string') {
    if (/timeout/i.test(message)) return 'TIMEOUT';
    if (message.includes('API key') || message.includes('API_KEY_INVALID')) {
      return 'INVALID_API_KEY';
    }
  }

  return 'UPSTREAM_FAILED';
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
