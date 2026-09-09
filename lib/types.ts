/**
 * 관상사주 분석 — 백엔드와 프론트엔드가 공유하는 계약.
 * 이 파일은 오케스트레이터가 고정했다. 구현 조각은 이 파일을 수정하지 않고 import 해서 쓴다.
 */

/** 오행 */
export const ELEMENTS = ['목', '화', '토', '금', '수'] as const;
export type Element = (typeof ELEMENTS)[number];

/** 얼굴 부위별 관상 소견 */
export interface FaceFeatures {
  forehead: string;
  eyes: string;
  nose: string;
  mouth: string;
  chin: string;
}

/** 부위 키 → 한국어 라벨. UI가 부위별 항목을 개별 렌더할 때 쓴다. */
export const FEATURE_LABELS: Record<keyof FaceFeatures, string> = {
  forehead: '이마',
  eyes: '눈',
  nose: '코',
  mouth: '입',
  chin: '턱',
};

/** 관상에서 도출한 성격 해석 */
export interface Personality {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  social: string;
}

/** 사주 연관 해석 */
export interface SajuReading {
  element: Element;
  elementReason: string;
  fortune: string;
  advice: string;
}

/**
 * 어울리는 이성 유형.
 * traits는 **성향·분위기**를 적는다 — 외모의 우열을 매기는 표현은 넣지 않는다.
 */
export interface IdealPartner {
  /** 한 줄 유형 요약 (예: "느긋하게 들어주는 사람") */
  type: string;
  /** 잘 맞는 성향·분위기 */
  traits: string[];
  /** 관상적으로 그렇게 보는 근거 */
  reason: string;
}

/** 애정운 */
export interface Romance {
  /** 연애할 때 드러나는 성향 */
  tendency: string;
  /** 애정운의 흐름 */
  fortune: string;
  /** 주의할 점 */
  caution: string;
}

/** 애정 파트 — 어울리는 상대와 애정운 */
export interface LoveReading {
  idealPartner: IdealPartner;
  romance: Romance;
}

/** 분석 성공 결과 */
export interface FaceReading {
  features: FaceFeatures;
  personality: Personality;
  saju: SajuReading;
  love: LoveReading;
}

/** 오류 분류. 새 코드를 추가하면 ERROR_CODES에도 반드시 추가한다. */
export const ERROR_CODES = [
  'NO_IMAGE',
  'BAD_IMAGE_FORMAT',
  'IMAGE_TOO_LARGE',
  'NO_API_KEY',
  'INVALID_API_KEY',
  'NO_FACE',
  'UPSTREAM_FAILED',
  'UNPARSABLE_RESPONSE',
  'TIMEOUT',
] as const;
export type AnalyzeErrorCode = (typeof ERROR_CODES)[number];

/** 업로드가 허용되는 이미지 MIME */
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** base64 디코딩 기준 이미지 크기 상한 (4MB) */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** POST /api/analyze 성공 응답 본문 */
export interface AnalyzeSuccessBody {
  ok: true;
  result: FaceReading;
  /** 업스트림 호출에 걸린 시간(ms). 응답 시간 목표 검증용. */
  elapsedMs: number;
}

/** POST /api/analyze 실패 응답 본문 */
export interface AnalyzeErrorBody {
  ok: false;
  code: AnalyzeErrorCode;
  /** 사용자에게 그대로 보여줄 한국어 메시지 */
  message: string;
}

export type AnalyzeResponseBody = AnalyzeSuccessBody | AnalyzeErrorBody;

/** 관용 파서의 판정 결과 */
export type ParseResult =
  | { kind: 'ok'; reading: FaceReading }
  | { kind: 'noface'; reason: string }
  | { kind: 'unparsable'; raw: string };

/** 이미지 데이터 URL 검증 결과 */
export type ImageValidation =
  | { ok: true; mimeType: string; base64: string }
  | { ok: false; code: Extract<AnalyzeErrorCode, 'NO_IMAGE' | 'BAD_IMAGE_FORMAT' | 'IMAGE_TOO_LARGE'> };

/** 마지막 결과를 브라우저에 임시 저장할 때 쓰는 키 */
export const SAVED_RESULT_KEY = 'face-reading:last-result';

/** 저장 포맷 버전. 올리면 이전 저장분은 버린다. */
export const SAVED_RESULT_VERSION = 1;

/**
 * 미리보기 이미지를 함께 저장할 수 있는 최대 크기(1MB).
 * localStorage는 대개 5MB 남짓이고 원본 사진은 4MB까지 허용되므로,
 * 큰 사진은 이미지를 빼고 해석 결과만 저장한다.
 */
export const MAX_SAVED_PREVIEW_BYTES = 1024 * 1024;

/** localStorage에 담기는 값 */
export interface SavedResult {
  version: number;
  /** 저장 시각 (epoch ms) */
  savedAt: number;
  /** 용량이 커서 뺐으면 null */
  preview: string | null;
  result: FaceReading;
}

/**
 * 분석에 쓰는 업스트림 클라이언트의 최소 인터페이스.
 * 테스트가 가짜를 주입할 수 있도록 좁게 정의했다 — 이 경계 덕분에 테스트는 네트워크를 타지 않는다.
 */
export interface VisionClient {
  /** 이미지와 프롬프트를 받아 모델의 원문 텍스트를 반환한다. */
  generate(input: { base64: string; mimeType: string; prompt: string }): Promise<string>;
}
