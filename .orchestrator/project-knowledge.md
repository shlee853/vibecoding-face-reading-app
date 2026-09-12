# 프로젝트 지식 — 관상사주 분석 웹앱

이전 주행이 알아낸 사실. **코드를 읽으면 알 수 있는 세부는 여기 적지 않는다.**
여기 있는 것과 코드가 어긋나면 **코드를 신뢰하고 이 문서를 고친다.**

---

## 환경 제약 (주행 계획에 직접 영향)

### npm 레지스트리가 차단되어 있다 — 새 의존성을 설치할 수 없다
`npm ping`이 프록시 오류로 실패한다 (20260909-065503 주행에서 관측, 1회).
**계획 단계에서 설치를 전제하지 마라.** 테스트 프레임워크, DOM 구현체, 아이콘 라이브러리 등
전부 해당된다.

**대안이 이미 갖춰져 있다**: `npm test`가 `node:test` + `tsc`로 돈다
(`tsconfig.test.json` → `.test-out/`). 설치 없이 동작하며 검증됨.

### 포트 바인딩은 **이제 열려 있다** — 브라우저 실검증이 가능하다
2026-09-09 주행에서는 `next dev`가 `listen EPERM`으로 죽었으나, 사용자가 샌드박스 설정을
열어 **2026-09-10 주행에서는 정상 바인딩된다.** 주행 시작 시 이걸로 확인해라:
```
node -e "require('net').createServer().listen(3111,'127.0.0.1',function(){console.log('OK');this.close()}).on('error',e=>console.log('차단:',e.code))"
```
막혀 있으면 뚫지 말고 계획을 줄여라 (무인 주행 중에는 승인 창을 띄울 수 없다).

**브라우저 검증 요령** (20260910 주행에서 실제로 쓴 것):
- `window.fetch`를 스텁으로 갈아끼워 분석 응답을 주입한다 — 유료 호출 없이 결과 화면을 본다
- `navigator.mediaDevices.getUserMedia`를 `canvas.captureStream()`으로 대체하면
  **카메라 흐름 전체를 실제로 검증**할 수 있다. 트랙의 `stop`을 래핑해 호출 횟수를 세면
  스트림 정리까지 확인된다
- `read_page`가 간헐적으로 `viewport 0x0`을 내며 빈 결과를 준다. 그때는
  `javascript_tool`로 `getBoundingClientRect()`를 읽어 좌표를 구해라.
  **좌표 프레임은 뷰포트의 1/1.6이다** (뷰포트 1280×720 → 프레임 800×450)

**보조 수단**: `.orchestrator/runs/*/render-check.js` — 컴포넌트를 `renderToStaticMarkup`으로
렌더해 HTML을 단언한다. 브라우저보다 빠르고 안정적이라 **표시 내용 검증은 이걸 먼저 쓰고**,
상태 전이·클릭만 브라우저로 확인하는 편이 낫다. 새 UI 주행은 픽스처만 바꾸면 된다.
(`jsdom`은 여전히 미설치·설치 차단이라 컴포넌트 단위 이벤트 테스트는 불가능하다.)

### `next build`를 돌렸으면 `.next`를 반드시 지워라 ★
검증 목적으로 `npx next build`를 돌리면 `.next/`가 **프로덕션** 산출물로 덮인다.
그 뒤 사용자가 `next dev`를 띄우면 dev 런타임과 프로덕션 페이지 청크가 섞여
`Cannot find module './NNN.js'`로 죽는다 (20260909-065503 주행 후 실제 발생).

증상 구분법: `.next/server/app/page.js`와 `.next/server/webpack-runtime.js`의
**타임스탬프가 다르면** 섞인 상태다.

**규칙**: 주행 중 `next build`를 돌렸다면 종료 전에 `rm -rf .next`를 한다.
빌드 성공 여부만 알면 되고 산출물은 필요 없기 때문이다.
`.next`는 gitignore 대상이고 전부 재생성되므로 지워도 잃는 것이 없다.

### ★★ 샌드박스 안에서 띄운 dev 서버는 Gemini에 닿지 못한다 — 사용자에게 안내하지 마라
포트 바인딩은 열렸지만 **네트워크 egress는 여전히 필터링된다.**
`generativelanguage.googleapis.com`은 DNS 조회부터 실패한다(`ENOTFOUND`, 2026-09-11 확인).

그래서 오케스트레이터가 띄운 서버로 분석을 실행하면 **항상** 실패한다:
```
[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/... : fetch failed
```

**실제로 저지른 실수**: 검증용으로 띄운 서버(3300)를 사용자에게 "여기서 테스트하세요"라고
안내했다. 사용자는 자기 앱이 고장 난 줄 알고 한참을 헤맸다.

**규칙**:
- 오케스트레이터가 띄운 서버는 **UI 검증 전용**이다. 분석 실행은 못 한다.
- **사용자에게 그 URL을 테스트용으로 주지 마라.** 실제 분석은 사용자가 자기 터미널에서
  `npm run dev`로 띄운 서버에서만 된다 (샌드박스 밖이라 외부 통신이 된다).
- 검증이 끝나면 서버를 끄고, 못 끄면 사용자에게 정리 방법을 알려라.
  `lsof -ti:<포트> | xargs kill -9` (샌드박스가 kill을 막는 경우가 있다)

### 모델명 `'gemini-3.6-flash'`는 유효하다 (확인됨)
오래 "미확인 전제"로 남아 있었으나, 사용자 환경에서 `POST /api/analyze 200 in 15890ms`로
실제 성공했다. 모델명 자체는 문제가 아니다.

### 실제 Gemini API를 호출하면 과금된다
`.env.local`에 실제 키가 들어 있다. **안전경계 4에 걸리므로 호출하지 마라.**
`lib/gemini.ts`의 `analyzeFace`는 `VisionClient`를 주입받게 설계돼 있어 가짜로 대체 가능하다.
`createGeminiClient()`는 **import는 해도 실행하지 마라.**

---

## 기술 제약

### `@google/generative-ai`가 0.1.3이고 올릴 수 없다
`GenerationConfig`에 `responseMimeType`도 `responseSchema`도 **없다** (d.ts 직접 확인).
즉 **JSON 모드를 쓸 수 없다.** 구조화 출력은 `lib/prompt.ts`가 프롬프트로 지시하고
`lib/parse.ts`의 관용 파서가 회수하는 방식으로 되어 있다.

SDK를 올릴 수 있게 되면 `lib/gemini.ts`에서 스키마를 넘기고 `lib/parse.ts`의 관용 경로를
단순화할 수 있다. **계약(`lib/types.ts`)은 그대로 쓸 수 있게 설계돼 있다.**

### `lib/` 안에서는 상대 경로로 import 해야 한다
`tsc`가 `paths` 별칭을 출력 JS에 다시 쓰지 않으므로, `lib/`에서 `@/lib/...`를 쓰면
**테스트 컴파일 결과가 런타임에 모듈을 못 찾는다.** `app/` 안에서는 별칭을 써도 된다
(Next.js 번들러가 처리하고 `app/`은 테스트 컴파일 대상이 아니다).

### 모델명 `'gemini-3.6-flash'`는 미검증 전제다
스프린트 1에서 온 값을 유지하고 있으나, 실제 호출을 한 적이 없어 SDK 0.1.3 경로에서
유효한지 확인되지 않았다. 분석이 실패한다면 여기를 먼저 의심하라.

---

## 아키텍처 요지 (계약 위주 — 세부는 코드를 봐라)

- **`lib/types.ts`가 백엔드와 프론트엔드의 유일한 접점이다.** 프론트는 이 파일만 import 하고
  `lib/`의 다른 모듈(서버 전용)은 건드리지 않는다.
- API는 **HTTP 상태가 아니라 본문의 `ok` 필드로 성패를 판단**하게 되어 있다. 실패도 JSON을 준다.
- 오류는 코드 9종으로 분류되고, 한국어 메시지는 **서버(`lib/errors.ts`)가 만든다.**
  프론트는 받은 `message`를 그대로 표시한다 — 자체 문구로 갈아치우지 마라
  (네트워크 자체가 끊긴 경우만 예외).
- 얼굴 미인식은 오류이자 **분석 결과의 한 갈래**다 (`ParseResult`의 `kind: 'noface'`).
  모델이 `faceDetected: false`를 주는 스키마에 기대고 있다.
- 화면 상태는 판별 유니온 `View`로 모델링돼 있어 **결과와 오류가 동시에 보이는 상태가
  구조적으로 불가능하다.** 이 성질을 깨는 리팩터링을 하지 마라.

---

### 카메라는 보안 컨텍스트를 요구한다
`getUserMedia`는 HTTPS 또는 `localhost`에서만 동작한다. **평문 HTTP로 배포하면 카메라가
아예 뜨지 않는다.** 배포 시 반드시 확인할 것.

### 애정 파트(`love`)는 필수 필드다
`FaceReading.love`가 없으면 `parseAnalysis`가 `unparsable`을 낸다 (선택 필드가 아니다).
모델이 애정 파트만 빠뜨려도 결과 전체가 오류가 된다 — **의도된 설계다**
(조용히 사라지는 것보다 드러나는 편이 낫다는 판단, 주행 20260910 D4).

### `lib/prompt.ts`의 외모 평가 가드레일을 함부로 줄이지 마라
애정 파트 지시에 외모 우열 금지·성별 단정 금지·경향형 표현 원칙이 문장으로 들어 있다.
"어떤 이성과 어울리는지"는 외모 서열 평가로 흐르기 쉬워서 의도적으로 넣은 것이다.
프롬프트를 다듬을 때 이 문단을 압축·삭제하지 마라.

### 저장 포맷을 바꾸면 `SAVED_RESULT_VERSION`을 올려라
`lib/storage.ts`의 `loadResult`는 버전이 다르면 저장분을 버린다. 포맷을 바꾸고 버전을
안 올리면 옛 저장분이 새 코드로 흘러들어간다.

## 배포 (2026-09-12부터 운영 중)

**서비스 주소**: https://168-107-8-13.sslip.io
Oracle Cloud Ubuntu 24.04 / x86_64 / 956Mi + 스왑 4GB / Node v22 (nvm) / nginx 1.24

- 절차는 `DEPLOY.md`. 갱신은 `./scripts/build-deploy.sh` → scp → `systemctl restart face-reading`.
- **서버에서 빌드하지 마라.** 메모리가 956Mi뿐이라 `next build`가 OOM 난다.
  로컬에서 standalone 번들을 만들어 올린다. 번들에 네이티브 바이너리가 없어
  arm64 Mac → x86_64 서버 이식이 안전하다(확인함).
- **`scripts/build-deploy.sh`를 쓰고 직접 tar로 묶지 마라.** standalone은 `.next/static`을
  포함하지 않아서, 빠뜨리면 화면은 뜨는데 JS가 404나 버튼이 전혀 동작하지 않는다.
- **systemd `ExecStart`에는 node 절대 경로가 필요하다.** 이 서버의 node는 nvm 아래
  (`/home/ubuntu/.nvm/versions/node/v22.22.0/bin/node`)에 있다. `/usr/bin/node`로 두면
  `status=203/EXEC`로 무한 재시작하고, 밖에서는 **502로만 보여** 원인이 가려진다.
  node 버전을 올리면 이 경로가 깨지므로 주의.
- 오케스트레이터의 샌드박스는 **SSH(TCP 22)가 EPERM으로 막히지만 HTTP/HTTPS는 통과한다.**
  그래서 배포 자체는 사용자가 하고, **검증은 오케스트레이터가 외부에서 직접 할 수 있다**
  (헬스체크·정적 파일·요청 제한까지 확인 가능).

### 자동 배포 (2026-09-12부터) — `git push`만 하면 된다
`.github/workflows/deploy.yml`. main 푸시 → 타입검사·테스트 → 빌드 → scp → 재시작 → 버전 확인.
검증 실패 시 배포하지 않고, 헬스체크 실패 시 `remote-install.sh`가 이전 버전으로 되돌린다.
**더 이상 수동 scp가 필요 없다.** 문서·계획 파일만 바뀌면 배포는 건너뛴다(`paths-ignore`).

- **배포된 버전은 `/api/health`의 `version`**(커밋 해시)으로 확인한다. 빌드 시점에 박힌다.
- **CI 실패 원인은 오케스트레이터가 직접 읽을 수 있다.** 로그 본문은 인증이 필요하지만
  `::error::` 어노테이션은 공개 API로 읽힌다:
  `GET /repos/{o}/{r}/commits/{sha}/check-runs` → `GET /repos/{o}/{r}/check-runs/{id}/annotations`
  그래서 실패할 때마다 사용자에게 로그 복사를 부탁하지 않아도 된다.
  **새 CI 단계를 추가할 때는 실패 사유를 `::error::`로 내보내라** — 안 그러면
  `exit code 1`만 남아 진단이 막힌다.
- 인증 없는 GitHub API는 시간당 60회 제한이 있다. 폴링을 촘촘히 하면 `parse-fail`이 난다.

### Node 20과 22의 차이에 걸린 적이 있다
`node --test .test-out/tests/`처럼 **디렉토리를 넘기면 Node 22가 그것을 테스트 파일로 오인**해
실패한다(Node 22부터 인자를 글롭으로 해석). Node 20은 디렉토리를 탐색해줘서 로컬에서는
드러나지 않았다. `package.json`의 test 스크립트는 **파일 글롭**(`.../*.test.js`)을 쓴다.
로컬(20)과 CI(22)가 다르다는 점을 기억할 것.

### 모바일 업로드가 막혔던 원인
전송 전에 사진을 1024px로 줄이면서도 **그 이전에** 원본 파일을 4MB로 막고 있었다.
요즘 휴대폰 사진은 3~12MB라 정상 사진이 전부 거절됐다. 원본 상한은
`MAX_SOURCE_IMAGE_BYTES`(25MB, 브라우저 메모리 보호용)이고, 전송 상한(`MAX_IMAGE_BYTES`)은
**축소한 결과에만** 적용한다. 이 둘을 다시 섞지 말 것.

## 미해결 / 다음이 볼 것

- **응답 시간 5초 목표가 실측된 적이 없다.** 스프린트 2 DoD의 유일한 잔여 항목.
  성공 응답의 `elapsedMs`로 확인할 수 있다.
- **`NoFaceNotice`의 버튼 문구와 동작이 어긋난다.** "다른 사진으로 다시 시도"인데 이전
  미리보기가 남는다. 스프린트 2 주행에서 발견했으나 범위 밖이라 고치지 않았다.
- **`<img>` 사용에 대한 `next build` 경고**가 스프린트 1부터 있다. 기능 영향 없음.
- **빈 배열 처리가 일관되지 않다.** `love.idealPartner.traits`는 빈 배열이면 `unparsable`인데
  `personality.strengths`/`weaknesses`는 빈 배열도 통과한다. 회귀를 피하려고 기존 동작을
  건드리지 않은 결과다 (주행 20260910). 맞출지 결정 필요.
- **실제 웹캠으로 촬영해 본 적이 없다.** 카메라 흐름은 가짜 캔버스 스트림으로만 검증됐다.
  화질·모바일 `facingMode`·브라우저별 권한 UI는 미확인.
- **애정 파트가 늘어 결과 화면이 길어졌다.** 모바일 스크롤이 꽤 길다 — 섹션 접기 검토 여지.
