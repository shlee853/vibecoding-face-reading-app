/**
 * 통합 검증 — 프론트엔드 수락 기준을 "실제 렌더 결과"로 판정한다.
 *
 * 왜 이렇게 하나: 샌드박스가 포트 바인딩(listen)을 막아 dev 서버를 띄울 수 없다.
 * 그렇다고 grep으로 "섹션이 있는가"를 확인하면 명세 게이밍을 못 잡는다.
 * 그래서 컴포넌트를 renderToStaticMarkup으로 실제 렌더해 HTML을 보고 판정한다.
 *
 * 실행: node .orchestrator/runs/<RUN>/render-check.js   (프로젝트 루트에서)
 */
const Module = require('module');
const path = require('path');
const assert = require('node:assert/strict');

const OUT = path.resolve(__dirname, '../../../.test-out/render');

// tsc는 paths 별칭을 출력 JS에 다시 쓰지 않으므로 런타임에 매핑해 준다.
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) {
    return origResolve.call(this, path.join(OUT, request.slice(2)), ...rest);
  }
  return origResolve.call(this, request, ...rest);
};

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const ResultView = require(path.join(OUT, 'app/components/ResultView')).default;
const ErrorBanner = require(path.join(OUT, 'app/components/ErrorBanner')).default;
const NoFaceNotice = require(path.join(OUT, 'app/components/NoFaceNotice')).default;
const UploadPanel = require(path.join(OUT, 'app/components/UploadPanel')).default;
const Home = require(path.join(OUT, 'app/page')).default;
const { FEATURE_LABELS } = require(path.join(OUT, 'lib/types'));

const html = (el) => renderToStaticMarkup(el);

/** 고유 토큰을 섞어 우연한 문자열 일치를 배제한다. */
const FIXTURE = {
  features: {
    forehead: '이마가 넓고 둥글다 [FX-FOREHEAD]',
    eyes: '눈매가 길고 눈빛이 맑다 [FX-EYES]',
    nose: '콧대가 곧고 코끝이 도톰하다 [FX-NOSE]',
    mouth: '입꼬리가 살짝 올라가 있다 [FX-MOUTH]',
    chin: '턱선이 단정하고 안정적이다 [FX-CHIN]',
  },
  personality: {
    summary: '차분하면서도 추진력이 있다 [FX-SUMMARY]',
    strengths: ['끈기 [FX-STR1]', '통찰력 [FX-STR2]'],
    weaknesses: ['조급함 [FX-WEAK1]', '완벽주의 [FX-WEAK2]'],
    social: '먼저 다가가기보다 신뢰를 쌓는 편 [FX-SOCIAL]',
  },
  saju: {
    element: '수',
    elementReason: '이마와 턱의 균형이 수 기운을 나타낸다 [FX-REASON]',
    fortune: '올해 후반부터 흐름이 트인다 [FX-FORTUNE]',
    advice: '결정을 서두르지 말 것 [FX-ADVICE]',
  },
};

const results = [];
function check(id, desc, fn) {
  try {
    fn();
    results.push({ id, desc, ok: true, note: '' });
  } catch (e) {
    results.push({ id, desc, ok: false, note: e.message.split('\n')[0].slice(0, 160) });
  }
}

// ── B1. 결과가 섹션별·부위별로 구조화되어 렌더된다 ─────────────────────
check('B1', '3개 대분류 + 부위별 5항목이 개별 렌더된다', () => {
  const out = html(React.createElement(ResultView, { preview: null, result: FIXTURE }));

  for (const heading of ['얼굴 특징', '성격 해석', '사주와의 연관']) {
    assert.ok(out.includes(heading), `대분류 누락: ${heading}`);
  }
  // 부위 라벨이 자체 엘리먼트로 렌더되어야 한다 (텍스트 뭉치에 섞인 것이 아니라)
  for (const key of Object.keys(FEATURE_LABELS)) {
    const label = FEATURE_LABELS[key];
    assert.ok(new RegExp(`>${label}<`).test(out), `부위 라벨이 개별 엘리먼트가 아님: ${label}`);
    assert.ok(out.includes(FIXTURE.features[key]), `부위 소견 누락: ${key}`);
  }
  // 섹션 순서: 얼굴 특징 → 성격 해석 → 사주
  assert.ok(
    out.indexOf('얼굴 특징') < out.indexOf('성격 해석') &&
      out.indexOf('성격 해석') < out.indexOf('사주와의 연관'),
    '섹션 순서가 얼굴특징→성격→사주가 아님'
  );
});

check('B1b', 'strengths/weaknesses가 항목별 목록으로 렌더된다', () => {
  const out = html(React.createElement(ResultView, { preview: null, result: FIXTURE }));
  for (const item of [...FIXTURE.personality.strengths, ...FIXTURE.personality.weaknesses]) {
    assert.ok(new RegExp(`<li[^>]*>${item.replace(/[[\]]/g, '\\$&')}</li>`).test(out),
      `목록 항목이 <li>로 렌더되지 않음: ${item}`);
  }
  assert.ok(out.includes(FIXTURE.personality.summary), 'summary 누락');
  assert.ok(out.includes(FIXTURE.personality.social), 'social 누락');
});

// ── B2. 사주 섹션이 오행과 근거 4개 값을 보여준다 ──────────────────────
check('B2', '사주 4개 값(오행·근거·운세·조언)이 모두 렌더된다', () => {
  const out = html(React.createElement(ResultView, { preview: null, result: FIXTURE }));
  assert.ok(new RegExp(`>${FIXTURE.saju.element}<`).test(out), '오행 글자가 개별 렌더되지 않음');
  for (const v of [FIXTURE.saju.elementReason, FIXTURE.saju.fortune, FIXTURE.saju.advice]) {
    assert.ok(out.includes(v), `사주 필드 누락: ${v}`);
  }
});

// ── B3. 얼굴 미인식 전용 안내 ─────────────────────────────────────────
check('B3', 'NO_FACE는 전용 안내 + 재시도 경로를 렌더한다', () => {
  const msg = '얼굴을 찾지 못했습니다 [FX-NOFACE-MSG]';
  const out = html(React.createElement(NoFaceNotice, { message: msg, onRetry: () => {} }));
  assert.ok(out.includes(msg), '서버 메시지가 그대로 표시되지 않음');
  assert.ok(/다시 시도|다른 사진/.test(out), '재시도 경로가 없음');
  assert.ok(out.includes('<button'), '재시도 컨트롤(button)이 없음');
  // 일반 오류 배너와 구별되는 안내가 있어야 한다
  const banner = html(React.createElement(ErrorBanner, { message: msg, onRetry: () => {} }));
  assert.notEqual(out, banner, 'NO_FACE 안내가 일반 오류 배너와 동일함');
  assert.ok(out.length > banner.length, 'NO_FACE 안내에 추가 안내 내용이 없음');
});

// ── B4. 일반 오류는 서버 메시지를 그대로 표시 ─────────────────────────
check('B4', '서버가 준 message를 가공 없이 그대로 표시한다', () => {
  const msg = 'API 키가 유효하지 않습니다 [FX-ERR-MSG]';
  const out = html(React.createElement(ErrorBanner, { message: msg, onRetry: () => {} }));
  assert.ok(out.includes(msg), '서버 메시지가 그대로 표시되지 않음');
});

// ── B8. 로딩 상태 ─────────────────────────────────────────────────────
check('B8', '로딩 중 버튼 비활성화 + 진행 표시', () => {
  const props = {
    preview: 'data:image/jpeg;base64,AAAA',
    fileInputRef: { current: null },
    onFileChange: () => {},
    onClearPreview: () => {},
    onAnalyze: () => {},
  };
  const loading = html(React.createElement(UploadPanel, { ...props, isLoading: true }));
  const idle = html(React.createElement(UploadPanel, { ...props, isLoading: false }));
  const noPreview = html(React.createElement(UploadPanel, { ...props, preview: null, isLoading: false }));

  // ★ Tailwind 클래스에 "disabled:" 접두사가 들어 있으므로 부분 문자열 검사는 속는다.
  //   React가 실제 속성으로 내보내는 형태(`<button disabled=""`)로만 판정한다.
  const isDisabled = (h) => /<button disabled=""/.test(h);

  assert.ok(/분석\s*중/.test(loading), '로딩 중 진행 표시가 없음');
  assert.ok(isDisabled(loading), '로딩 중 버튼이 비활성화되지 않음');
  assert.ok(!/분석\s*중/.test(idle), '유휴 상태인데 로딩 표시가 보임');
  assert.ok(!isDisabled(idle), '미리보기가 있고 유휴인데 분석 버튼이 비활성화됨');
  assert.ok(isDisabled(noPreview), '미리보기가 없는데 분석 버튼이 활성화됨');
});

// ── 초기 화면 (회귀 방지) ─────────────────────────────────────────────
check('B0', '초기 화면에 업로드 안내가 렌더된다', () => {
  const out = html(React.createElement(Home));
  assert.ok(out.includes('사진을 업로드하세요'), '업로드 안내 누락');
  assert.ok(out.includes('관상 분석하기'), '분석 버튼 누락');
  assert.ok(!out.includes('얼굴 특징'), '초기 화면에 결과 섹션이 보임');
});

// ── 결과 화면에 오류가 동시에 보이지 않는다 (판별 유니온 구조 확인) ────
check('B7s', '결과 렌더에 오류 배너가 섞이지 않는다', () => {
  const out = html(React.createElement(ResultView, { preview: null, result: FIXTURE }));
  assert.ok(!/다시 시도<\/button>/.test(out), '결과 화면에 오류 재시도 버튼이 섞임');
});

// ── 출력 ──────────────────────────────────────────────────────────────
let failed = 0;
console.log('\n실제 렌더 기반 검증 결과\n' + '─'.repeat(64));
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? '통과' : '실패'}  ${r.id.padEnd(5)} ${r.desc}`);
  if (!r.ok) console.log(`            └ ${r.note}`);
}
console.log('─'.repeat(64));
console.log(`${results.length}건 중 통과 ${results.length - failed} / 실패 ${failed}\n`);
process.exit(failed ? 1 : 0);
