# 모듈 계약 — 스프린트 2

**오케스트레이터가 고정했다.** `test-author`는 이 시그니처에 대고 테스트를 쓰고,
`implementer`는 이 시그니처대로 구현한다. **양쪽 모두 이 계약을 바꿀 수 없다.**
계약이 모순되거나 불가능하면 각자 멈추고 보고한다.

데이터 타입은 전부 `lib/types.ts`에 이미 있다 (수정 금지, import 해서 쓴다).

## ★ 임포트 규칙 (어기면 테스트가 안 돈다)

- **`lib/` 안의 모듈끼리는 상대 경로로 import 한다** — `./types`, `./parse`. `@/lib/...` 금지.
  이유: 테스트는 `tsc`로 CommonJS로 컴파일해 `node --test`로 돈다. `tsc`는 `paths` 별칭을
  출력에 다시 쓰지 않으므로, 별칭을 쓰면 컴파일된 JS가 `require("@/lib/types")`가 되어
  런타임에 모듈을 못 찾는다.
- **`app/` 안에서는 `@/lib/types` 별칭을 써도 된다** — Next.js 번들러가 처리하고,
  `app/`은 테스트 컴파일 대상이 아니다.

---

## `lib/prompt.ts`

```ts
import type { FaceReading } from '@/lib/types';

/**
 * Gemini에게 넘길 분석 프롬프트를 만든다.
 * SDK 0.1.3에는 responseSchema가 없으므로, JSON 형식 준수를 프롬프트로 지시하는 것이
 * 유일한 구조화 수단이다.
 *
 * 반환 문자열은 반드시 아래를 문자 그대로 포함한다:
 *  - 최상위 키: "faceDetected", "features", "personality", "saju"
 *  - features 하위: "forehead", "eyes", "nose", "mouth", "chin"
 *  - personality 하위: "summary", "strengths", "weaknesses", "social"
 *  - saju 하위: "element", "elementReason", "fortune", "advice"
 *  - 오행 5종: "목", "화", "토", "금", "수"
 * 그리고 얼굴이 없으면 faceDetected:false 와 reason 을 달라고 지시해야 한다.
 */
export function buildAnalysisPrompt(): string;
```

## `lib/parse.ts`

```ts
import type { ParseResult } from '@/lib/types';

/**
 * 텍스트에서 첫 번째 JSON 객체를 회수한다.
 * ```json 펜스, 일반 ``` 펜스, 펜스 없는 raw JSON, 산문에 둘러싸인 JSON을 모두 다룬다.
 * 중괄호 균형을 맞춰 잘라내야 한다 (문자열 리터럴 안의 중괄호에 속지 말 것).
 * 회수·파싱에 실패하면 null.
 */
export function extractJsonBlock(raw: string): unknown | null;

/**
 * 모델 원문을 ParseResult로 판정한다.
 *  - faceDetected === false  → { kind: 'noface', reason }
 *    (reason이 비어 있으면 기본 문구로 채운다 — 절대 빈 문자열을 내보내지 않는다)
 *  - 유효한 FaceReading      → { kind: 'ok', reading }
 *  - 그 외                   → { kind: 'unparsable', raw }
 *
 * '유효'의 정의: features 5개 키, personality 4개 키, saju 4개 키가 모두 있고
 * 문자열 필드가 비어 있지 않으며 saju.element가 ELEMENTS 중 하나다.
 * strengths/weaknesses는 문자열 배열이어야 한다(문자열 하나가 오면 배열로 감싼다).
 * element가 '목木'처럼 군더더기와 함께 와도 5종 중 하나를 포함하면 그것으로 정규화한다.
 */
export function parseAnalysis(raw: string): ParseResult;
```

## `lib/image.ts`

```ts
import type { ImageValidation } from '@/lib/types';

/**
 * data URL을 mimeType과 base64로 쪼갠다. 형식이 아니면 null.
 */
export function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null;

/**
 * 업로드 입력을 검증한다.
 *  - 문자열이 아니거나 빈 문자열      → { ok:false, code:'NO_IMAGE' }
 *  - data URL이 아님 / MIME 미허용    → { ok:false, code:'BAD_IMAGE_FORMAT' }
 *  - 디코딩 크기가 MAX_IMAGE_BYTES 초과 → { ok:false, code:'IMAGE_TOO_LARGE' }
 *  - 그 외                            → { ok:true, mimeType, base64 }
 * 허용 MIME은 ALLOWED_MIME_TYPES, 상한은 MAX_IMAGE_BYTES (둘 다 types.ts).
 * 크기는 base64 길이로 추정한다 (실제 디코딩 불필요).
 */
export function validateImageDataUrl(input: unknown): ImageValidation;
```

## `lib/errors.ts`

```ts
import type { AnalyzeErrorCode } from '@/lib/types';

/** 모든 AnalyzeErrorCode에 대해 비어있지 않은 한국어 사용자 메시지를 준다. */
export function messageForCode(code: AnalyzeErrorCode): string;

/** 코드별 HTTP 상태. 입력 오류 4xx, 업스트림·설정 오류 5xx. */
export function statusForCode(code: AnalyzeErrorCode): number;

/**
 * 잡힌 예외를 오류 코드로 분류한다.
 *  - 메시지에 'API key'/'API_KEY_INVALID' 류 → 'INVALID_API_KEY'
 *  - AbortError / 메시지에 'timeout'          → 'TIMEOUT'
 *  - 그 외                                    → 'UPSTREAM_FAILED'
 */
export function classifyUpstreamError(e: unknown): AnalyzeErrorCode;

/** 코드로부터 응답 본문과 상태를 함께 만든다. */
export function toErrorResponse(code: AnalyzeErrorCode): {
  body: { ok: false; code: AnalyzeErrorCode; message: string };
  status: number;
};
```

## `lib/gemini.ts`

```ts
import type { ParseResult, VisionClient } from '@/lib/types';

/** 실제 Gemini 클라이언트를 만든다. 모델명은 기존 코드와 동일하게 'gemini-3.6-flash'를 유지한다. */
export function createGeminiClient(apiKey: string): VisionClient;

/**
 * 이미지를 분석해 ParseResult와 소요시간을 반환한다.
 * client를 주입받으므로 테스트는 네트워크를 타지 않는다.
 * 업스트림 예외는 잡지 않고 그대로 던진다 (분류는 라우트가 errors.ts로 한다).
 */
export function analyzeFace(
  input: { base64: string; mimeType: string },
  client: VisionClient
): Promise<{ parsed: ParseResult; elapsedMs: number }>;
```

**주의**: 기존 `lib/gemini.ts`의 `analyzeFaceWithGemini`는 어디서도 실제로 호출되지 않는
죽은 코드다 (`app/page.tsx`가 import만 하고 쓰지 않음). 제거한다.

## `app/api/analyze/route.ts`

```
POST { image: string }   // data URL

200 → AnalyzeSuccessBody   { ok:true, result, elapsedMs }
4xx/5xx → AnalyzeErrorBody { ok:false, code, message }
```

처리 순서:
1. body에서 `image`를 꺼내 `validateImageDataUrl` → 실패면 그 코드로 응답
2. `process.env.GEMINI_API_KEY` 없으면 `NO_API_KEY`
3. `createGeminiClient` → `analyzeFace`
4. `parsed.kind`에 따라: `ok`→200 / `noface`→`NO_FACE`(메시지는 파서가 준 reason 사용)
   / `unparsable`→`UNPARSABLE_RESPONSE`
5. 예외는 `classifyUpstreamError`로 분류해 응답

## 프론트엔드가 의존하는 것

프론트엔드는 **`lib/types.ts`만** import 한다. `lib/`의 다른 모듈은 서버 전용이므로
클라이언트 컴포넌트에서 import 하지 않는다. 통신은 `fetch('/api/analyze')` 하나뿐이고,
응답 본문은 `AnalyzeResponseBody`로 좁힌다 (`body.ok`로 분기).

`FEATURE_LABELS`를 써서 부위별 라벨을 렌더한다 — 라벨을 손으로 다시 쓰지 않는다.
