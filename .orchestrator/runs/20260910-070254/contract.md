# 모듈 계약 — 스프린트 3

**오케스트레이터가 고정했다.** `test-author`는 이 시그니처에 대고 테스트를 쓰고,
`implementer`는 이대로 구현한다. **양쪽 모두 바꿀 수 없다.** 모순되면 멈추고 보고한다.

데이터 타입은 전부 `lib/types.ts`에 이미 있다 (**수정 금지**, import 해서 쓴다).

## ★ 임포트 규칙 (어기면 테스트가 안 돈다)
- **`lib/` 안의 모듈끼리는 상대 경로** — `./types`, `./parse`. `@/lib/...` 금지.
  `tsc`가 `paths` 별칭을 출력 JS에 다시 쓰지 않아 `node --test`가 모듈을 못 찾는다.
- **`app/` 안에서는 `@/lib/types` 별칭 가능.**

---

## 새로 추가된 타입 (`lib/types.ts`, 이미 작성됨)

```ts
export interface IdealPartner { type: string; traits: string[]; reason: string }
export interface Romance { tendency: string; fortune: string; caution: string }
export interface LoveReading { idealPartner: IdealPartner; romance: Romance }

export interface FaceReading {
  features: FaceFeatures; personality: Personality; saju: SajuReading;
  love: LoveReading;          // ← 신규, 필수
}

export const SAVED_RESULT_KEY = 'face-reading:last-result';
export const SAVED_RESULT_VERSION = 1;
export const MAX_SAVED_PREVIEW_BYTES = 1024 * 1024;
export interface SavedResult {
  version: number; savedAt: number; preview: string | null; result: FaceReading;
}
```

---

## `lib/prompt.ts` (기존 파일 확장)

```ts
export function buildAnalysisPrompt(): string;
```
기존에 포함하던 키에 **더해** 아래를 문자 그대로 포함한다:
`love`, `idealPartner`, `type`, `traits`, `reason`, `romance`, `tendency`, `fortune`, `caution`.

**★ 가드레일 (필수)**: 프롬프트에 아래 취지의 지시를 **실제 문장으로** 넣는다.
- 어울리는 상대는 **성향·분위기**로 기술할 것 (예: "말을 끝까지 들어주는 사람")
- **외모의 우열·등급을 매기지 말 것.** "잘생긴/예쁜 정도가 비슷한" 같은 표현 금지
- 성별을 단정하지 말고, 단정적 예언이 아니라 경향으로 말할 것
- 재미 목적임을 잊지 말 것

키워드만 끼워넣는 것은 이 기준을 만족시키지 않는다. **오케스트레이터가 프롬프트 전문을 읽고
판정한다.**

## `lib/parse.ts` (기존 파일 확장)

```ts
export function extractJsonBlock(raw: string): unknown | null;   // 변경 없음
export function parseAnalysis(raw: string): ParseResult;          // love 검증 추가
```
`kind:'ok'` 조건에 **추가**된다:
- `love.idealPartner`의 `type`·`reason`이 비어있지 않은 문자열
- `love.idealPartner.traits`가 문자열 배열이며 비어있지 않음 (문자열 하나가 오면 배열로 감쌈)
- `love.romance`의 `tendency`·`fortune`·`caution`이 모두 비어있지 않은 문자열

하나라도 미달이면 `unparsable`. **기존 features·personality·saju 검증은 그대로 유지한다.**

## `lib/storage.ts` (신규)

```ts
import type { FaceReading, SavedResult } from './types';

/** localStorage/sessionStorage가 만족하는 최소 인터페이스. 테스트가 가짜를 주입한다. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * 결과를 저장한다.
 * preview가 MAX_SAVED_PREVIEW_BYTES를 넘으면 preview를 null로 바꿔 저장한다(결과는 보존).
 * setItem이 던져도(용량 초과 등) **예외를 밖으로 내지 않는다.** 저장 실패는 조용히 넘긴다.
 */
export function saveResult(storage: StorageLike, result: FaceReading, preview: string | null): void;

/**
 * 저장분을 읽는다. 아래는 전부 **예외 없이 null**:
 * 없음 / JSON 파싱 실패 / version !== SAVED_RESULT_VERSION / result 구조 불량.
 * 구조 검사는 features·personality·saju·love의 존재까지 본다.
 */
export function loadResult(storage: StorageLike): SavedResult | null;

/** 저장분을 지운다. removeItem이 던져도 예외를 밖으로 내지 않는다. */
export function clearResult(storage: StorageLike): void;
```
**모듈 최상위에서 `localStorage`를 만지지 마라.** 서버 렌더에서 죽는다.
크기는 문자열 길이로 판단한다.

---

## 프론트엔드

### `app/components/ResultView.tsx` (기존 확장)
props는 **바뀌지 않는다**: `{ preview: string | null; result: FaceReading }`.
기존 3섹션 뒤에 2섹션을 **추가**한다:
- **어울리는 이성**: `love.idealPartner.type`, `traits`(항목별 목록), `reason`
- **애정운**: `love.romance.tendency`, `fortune`, `caution`

### `app/components/CameraCapture.tsx` (신규)
```tsx
interface CameraCaptureProps {
  onCapture: (dataUrl: string) => void;   // 촬영 성공
  onCancel: () => void;                    // 사용자가 카메라를 접음
}
```
- 마운트 시 `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })`
- `<video autoPlay playsInline muted>`로 미리보기, 촬영은 `<canvas>` → `toDataURL('image/jpeg', 0.9)`
- **권한 거부(`NotAllowedError`) / 장치 없음(`NotFoundError`) / 미지원**을 구분해 한국어 안내
- **★ 언마운트와 촬영 완료, 취소 시 반드시 모든 트랙의 `stop()`을 호출한다.**
  안 끄면 카메라 표시등이 계속 켜져 있다.
- `navigator.mediaDevices`가 없는 환경에서도 죽지 않고 안내를 보여준다

### `app/components/UploadPanel.tsx` (기존 확장)
입력 수단 선택(업로드 / 카메라)을 추가한다. 기존 props는 유지하고 필요한 것만 더한다.

### `app/page.tsx` (기존 확장)
- 카메라 촬영 결과(dataUrl)를 기존 `preview`와 같은 경로로 흘려보낸다
- 분석 성공 시 `saveResult(window.localStorage, result, preview)` 호출
- 최초 마운트 시 `loadResult(window.localStorage)`로 복원 (**`useEffect` 안에서** —
  서버 렌더 중에 `window`를 만지면 죽는다)
- "다시 분석하기"에서 `clearResult` 호출
- `lib/storage`는 순수 모듈이라 `app/`에서 import 해도 된다 (`@/lib/storage`)
