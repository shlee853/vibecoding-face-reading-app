# 관상사주 분석 AI 웹앱

AI가 당신의 관상을 분석해 주는 웹 애플리케이션입니다.

## 개발 환경

- **Node.js**: v20.9.0 (로컬 설치)
- **프레임워크**: Next.js 14 (App Router)
- **스타일링**: Tailwind CSS
- **AI**: Google Gemini 2.0 Flash API
- **언어**: TypeScript

## 설정

### 1. Gemini API 키 발급

1. [Google AI Studio](https://ai.google.dev)에 접속
2. "Get API Key" 클릭
3. 새 프로젝트에서 API 키 생성

### 2. 환경 변수 설정

```bash
cp .env.local.example .env.local
# .env.local을 편집해서 Gemini API 키 입력
GEMINI_API_KEY=your_api_key_here
```

### 3. 의존성 설치

```bash
npm install
```

## 실행

### 개발 모드

```bash
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 열기

### 프로덕션 빌드

```bash
npm run build
npm start
```

## 파일 구조

```
├── app/
│   ├── api/
│   │   └── analyze/
│   │       └── route.ts         # Gemini API 호출 엔드포인트
│   ├── layout.tsx               # 루트 레이아웃
│   ├── page.tsx                 # 메인 페이지
│   └── globals.css              # 전역 스타일
├── public/                       # 정적 파일
├── package.json                 # 의존성 정의
├── tsconfig.json                # TypeScript 설정
├── tailwind.config.ts           # Tailwind 설정
└── next.config.js               # Next.js 설정
```

## 주요 기능

### Sprint 1 (현재 진행 중)
- ✅ 사진 업로드 UI
- ✅ Gemini API 연동
- ✅ 관상 분석 결과 표시
- ✅ 로딩 상태 표시
- ✅ 반응형 레이아웃

### Sprint 2 (예정)
- 사주 연관 분석 개선
- 오류 처리 고도화
- 결과 UI 개선

### Sprint 3 (선택)
- 카메라 촬영 기능
- 결과 저장 기능

## 개발 중 주의사항

1. **API 비용**: Gemini API는 무료 계정에 제한이 있습니다. 사용량을 모니터링하세요.
2. **이미지 보안**: 업로드된 이미지는 Gemini 서버로 전송됩니다. 민감한 정보는 포함하지 마세요.
3. **성능**: 큰 이미지는 업로드 시간이 길 수 있으니 압축을 권장합니다.

## 기술 스택 선택 이유

- **Next.js**: 풀스택 개발, 빠른 성능, 내장 최적화
- **Gemini 2.0 Flash**: 빠른 응답시간, 이미지 분석에 최적화
- **Tailwind CSS**: 빠른 스타일링, 반응형 디자인

## 트러블슈팅

### npm install 실패
```bash
# Node.js PATH 확인
which node npm

# 또는 직접 실행
.node-versions/node-v20.9.0-darwin-arm64/bin/npm install
```

### Gemini API 오류
- API 키가 올바른지 확인
- API 할당량이 남았는지 확인
- 이미지 형식 확인 (JPEG, PNG, WebP, GIF)

### 포트 3000 이미 사용 중
```bash
# 다른 포트로 실행
npm run dev -- -p 3001
```

## 라이선스

MIT
