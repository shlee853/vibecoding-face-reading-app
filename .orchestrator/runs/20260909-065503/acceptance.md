# 수락 기준 — 스프린트 2 (분석 결과 고도화 & MVP 완성)

주행 ID: 20260909-065503
출처: `planning/SPRINTS.md` 스프린트 2 DoD + `planning/PRD.md` P0/P1

**이 문서는 구현 시작 전에 확정됐다.** 이후 기준을 바꾸려면 `decisions.md`에 사유를 남긴다.

---

## 0. 검증 수단 (proxy가 아니라 실체를 본다)

| 수단 | 명령 | 무엇을 보장하나 |
|------|------|----------------|
| 타입 검사 | `npx tsc --noEmit` | JSX·타입 정합성. grep으로 못 속인다 |
| 단위 테스트 | `npm test` (`tsc -p tsconfig.test.json && node --test .test-out/tests/`) | 순수 로직의 **실제 동작** |
| 프로덕션 빌드 | `npx next build` | 앱이 실제로 빌드되는가 |
| 브라우저 실검증 | dev 서버 + `fetch` 스텁 주입 | UI가 **실제로 렌더되는가** |

**금지**: `grep`으로 문자열이 있는지 확인하는 것만으로 기준을 통과시키지 않는다.
기준마다 판정할 때는 검사 결과가 아니라 **아래 기준 문장으로 돌아가 대조한다.**

**비용 경계**: 실제 Gemini API는 **호출하지 않는다** (안전경계 4 — 유료 API 호출 금지).
모든 테스트는 주입된 가짜 클라이언트로 돈다. 실제 호출이 필요한 기준은 `B7`뿐이며 **차단 처리**한다.

---

## A. 백엔드 — 분석 로직과 오류 분류

### A1. 응답 계약이 타입으로 고정된다
`lib/types.ts`에 `FaceReading`, `AnalyzeSuccessBody`, `AnalyzeErrorBody`, `AnalyzeErrorCode`가
선언되어 있고, API 라우트와 프론트엔드가 **둘 다 이 타입을 import** 한다.
- 검증: `tsc --noEmit` 통과 + 두 파일에서 `@/lib/types` import 확인

### A2. 사주 연관 분석이 구조화된 필드로 존재한다
`FaceReading.saju`가 다음 필드를 **모두** 가진다: `element`(오행 5종 리터럴 유니온),
`elementReason`, `fortune`, `advice`.
- 검증: 타입 선언 + `parseAnalysis`가 이 필드들을 채운 객체를 반환하는 테스트 통과
- **게이밍 방지**: 필드가 선언만 되고 파서가 항상 빈 문자열을 넣으면 **실패**로 판정한다.
  테스트는 실제 샘플 응답에서 값이 비어있지 않음을 단언해야 한다.

### A3. 프롬프트가 JSON 스키마를 지시한다
`buildAnalysisPrompt()`가 반환하는 문자열이 `FaceReading`의 **모든 최상위 키와 saju 하위 키를
문자 그대로 포함**하고, 오행 5종과 `faceDetected`를 명시한다.
- 검증: 테스트가 각 키 이름의 포함을 단언
- 근거: SDK 0.1.3에 `responseSchema`가 없어 프롬프트 지시가 유일한 구조화 수단 (D3)

### A4. 관용 파서가 4가지 입력을 모두 처리한다
`parseAnalysis(raw)`가 아래 각각에 대해 지정된 `kind`를 반환한다:
| 입력 | 기대 |
|------|------|
| ```` ```json {...} ``` ```` 펜스로 감싼 정상 응답 | `kind: 'ok'`, 필드 채워짐 |
| 펜스 없는 raw JSON | `kind: 'ok'` |
| 앞뒤에 산문이 붙은 JSON | `kind: 'ok'` |
| `faceDetected: false` | `kind: 'noface'`, `reason` 비어있지 않음 |
| JSON이 전혀 없는 산문 | `kind: 'unparsable'` |
- 검증: 5개 케이스 각각 독립 테스트 통과

### A5. 이미지 입력 검증이 4가지를 거른다
`validateImageDataUrl(input)`이 아래를 각각 지정된 코드로 거부한다:
| 입력 | 기대 코드 |
|------|----------|
| `undefined` / `null` / `''` / 숫자 | `NO_IMAGE` |
| data URL이 아닌 문자열 | `BAD_IMAGE_FORMAT` |
| `data:image/bmp;base64,...` (미허용 MIME) | `BAD_IMAGE_FORMAT` |
| 4MB 초과 base64 | `IMAGE_TOO_LARGE` |
| 정상 `image/jpeg|png|webp` | `ok: true` + `mimeType`·`base64` 분리 |
- 검증: 각 케이스 독립 테스트 통과

### A6. 오류 분류기가 모든 코드에 한국어 메시지를 준다
`AnalyzeErrorCode`의 **모든** 값에 대해 `messageForCode(code)`가 비어있지 않은 한국어 문자열을
반환한다. 그리고 `toAnalyzeError()`가 아래를 매핑한다:
| 원인 | 기대 코드 |
|------|----------|
| API 키 미설정 | `NO_API_KEY` |
| 'API key not valid' 류 에러 | `INVALID_API_KEY` |
| 타임아웃/AbortError | `TIMEOUT` |
| 그 외 예외 | `UPSTREAM_FAILED` |
- 검증: 코드 목록을 **런타임에 순회**하며 메시지 존재를 단언 (하드코딩 나열 금지 —
  새 코드가 추가돼도 테스트가 잡아야 한다)

### A7. 분석 함수가 네트워크 없이 테스트된다
`analyzeFace(dataUrl, deps)`가 Gemini 클라이언트를 **주입받을 수 있고**, 주입된 가짜가
반환한 텍스트로 파싱까지 수행한다. 테스트 실행 중 실제 네트워크 호출이 **0회**다.
- 검증: 가짜 클라이언트로 성공/noface/unparsable 3경로 테스트 통과

### B7. 평균 응답 시간 5초 이내 검증 — **차단 예상**
실제 Gemini API 호출이 필요하므로 안전경계 4에 걸린다.
- 대체 이행: API 라우트가 `elapsedMs`를 측정해 성공 응답에 포함시킨다 (측정 **수단**은 구현).
- 판정: 수단 구현은 통과, **실측은 차단**으로 보고서에 넘긴다.

---

## B. 프론트엔드 — 결과 화면과 오류 표시

### B1. 결과가 섹션별로 구조화되어 렌더된다
성공 응답 주입 시 화면에 **3개 대분류**가 모두 나타난다: 얼굴 특징 / 성격 해석 / 사주 연관.
그리고 얼굴 특징은 **부위별 5항목**(이마·눈·코·입·턱)이 개별 항목으로 보인다.
- 검증: 브라우저에서 `fetch` 스텁으로 성공 응답 주입 후 `read_page`에 5개 부위 라벨과
  3개 대분류가 모두 존재
- **게이밍 방지**: 세 덩어리 텍스트를 그대로 흘려보내는 것은 실패. 부위별 라벨이 개별로 보여야 한다.

### B2. 사주 섹션이 오행과 근거를 보여준다
사주 섹션에 `element`(오행) 값과 `elementReason`, `fortune`, `advice`가 모두 렌더된다.
- 검증: 브라우저 `read_page`에서 주입한 4개 값의 텍스트가 모두 발견됨

### B3. 얼굴 미인식 시 전용 안내가 나온다
`NO_FACE` 응답 주입 시, 일반 오류 배너가 아니라 **얼굴을 찾지 못했다는 안내**와
**다른 사진으로 다시 시도할 수 있는 경로**가 화면에 있다.
- 검증: 브라우저에서 해당 문구 + 재시도 컨트롤 존재 확인

### B4. API 실패 시 오류 메시지가 표시된다
`UPSTREAM_FAILED` / `INVALID_API_KEY` 응답 주입 시 서버가 준 `message`가 화면에 그대로 보인다.
- 검증: 브라우저에서 주입한 메시지 문자열이 `read_page`에 나타남

### B5. 파일 형식 오류가 업로드 시점에 걸린다
허용되지 않은 MIME의 파일을 선택하면 서버 호출 없이 화면에 오류가 표시된다.
- 검증: 브라우저에서 `DataTransfer`로 `text/plain` 파일 주입 → 오류 문구 노출 +
  네트워크 요청 0건 (`read_network_requests`)

### B6. 다시 분석 버튼이 초기 상태로 되돌린다
결과 화면에서 "다시 분석" 실행 시 결과·오류·미리보기가 모두 사라지고 업로드 화면으로 돌아간다.
- 검증: 브라우저에서 결과 렌더 → 버튼 클릭 → 업로드 영역 재등장 및 결과 텍스트 소멸

### B8. 로딩 상태가 유지된다 (스프린트 1 회귀 방지)
분석 중에는 버튼이 비활성화되고 진행 표시가 보인다.
- 검증: 브라우저에서 응답을 지연시킨 스텁으로 로딩 상태 확인

---

## C. 전역 — 회귀와 위생

### C1. 타입 검사 통과
`npx tsc --noEmit` 오류 0건.

### C2. 프로덕션 빌드 성공
`npx next build` 성공 종료.

### C3. 전체 테스트 통과
`npm test` — fail 0.

### C4. 죽은 코드가 남지 않는다
스프린트 1의 미사용 import(`app/page.tsx`의 `analyzeFaceWithGemini`, `next/image`)가 제거된다.
- 검증: `npx next lint` 경고에 unused import 없음 + 해당 import 문 부재

### C5. 새 의존성이 추가되지 않는다
`package.json`의 `dependencies`·`devDependencies` 목록이 주행 시작 시점과 동일하다
(`scripts`에 `test` 추가는 허용).
- 근거: npm 레지스트리 차단 (D2). 설치 시도 자체가 실패한다.
- 검증: `git diff package.json`에 deps 변경 없음

---

## 판정 규칙

- **정상완료**: A1~A7, B1~B6, B8, C1~C5 전부 통과 + B7은 "수단 구현 완료 / 실측 차단"
- **부분완료**: 동일 조각이 3회 연속 실패해 포기한 항목이 있을 때
- **강제중단**: 스폰 8회 또는 벽시계 53분 초과
