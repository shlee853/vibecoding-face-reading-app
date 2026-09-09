/**
 * 통합 검증 — 결과 화면 수락 기준을 "실제 렌더 결과"로 판정한다.
 * 브라우저 검증(상태 전이·클릭)은 별도로 하고, 여기서는 표시 내용을 본다.
 *
 * 실행: node .orchestrator/runs/20260910-070254/render-check.js   (프로젝트 루트에서)
 */
const Module = require('module');
const path = require('path');
const assert = require('node:assert/strict');

const OUT = path.resolve(__dirname, '../../../.test-out/render');

// tsc는 paths 별칭을 출력 JS에 다시 쓰지 않으므로 런타임에 매핑한다.
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
  love: {
    idealPartner: {
      type: '말을 끝까지 들어주는 차분한 사람 [FX-IP-TYPE]',
      traits: [
        '재촉하지 않고 기다려주는 태도 [FX-TRAIT1]',
        '생각을 정리할 시간을 주는 편 [FX-TRAIT2]',
        '약속을 가볍게 여기지 않는 성향 [FX-TRAIT3]',
      ],
      reason: '눈매와 입매가 신중함을 드러내기 때문 [FX-IP-REASON]',
    },
    romance: {
      tendency: '천천히 마음을 여는 편 [FX-ROM-TENDENCY]',
      fortune: '익숙한 관계에서 인연이 열리는 흐름 [FX-ROM-FORTUNE]',
      caution: '속내를 너무 늦게 꺼내지 않도록 [FX-ROM-CAUTION]',
    },
  },
};

const results = [];
function check(id, desc, fn) {
  try {
    fn();
    results.push({ id, desc, ok: true, note: '' });
  } catch (e) {
    results.push({ id, desc, ok: false, note: e.message.split('\n')[0].slice(0, 170) });
  }
}
const esc = (s) => s.replace(/[[\]]/g, '\\$&');
const render = () => html(React.createElement(ResultView, { preview: null, result: FIXTURE }));

// ── D1. 어울리는 이성 섹션 ────────────────────────────────────────────
check('D1', '어울리는 이성: type·traits(항목별)·reason이 렌더된다', () => {
  const out = render();
  assert.ok(out.includes(FIXTURE.love.idealPartner.type), 'idealPartner.type 누락');
  assert.ok(out.includes(FIXTURE.love.idealPartner.reason), 'idealPartner.reason 누락');
  // traits는 개별 항목이어야 한다 — join(', ')으로 이어붙이면 실패
  for (const t of FIXTURE.love.idealPartner.traits) {
    assert.ok(new RegExp(`<li[^>]*>${esc(t)}</li>`).test(out), `traits가 <li>로 렌더되지 않음: ${t}`);
  }
  assert.ok(!out.includes(FIXTURE.love.idealPartner.traits.join(', ')), 'traits가 한 줄로 이어붙여짐');
});

// ── D2. 애정운 섹션 ───────────────────────────────────────────────────
check('D2', '애정운: tendency·fortune·caution 3값이 모두 렌더된다', () => {
  const out = render();
  for (const [k, v] of Object.entries(FIXTURE.love.romance)) {
    assert.ok(out.includes(v), `romance.${k} 누락`);
  }
});

// ── D3. 스프린트 2 회귀 ───────────────────────────────────────────────
check('D3a', '회귀: 부위 5항목이 개별 렌더된다', () => {
  const out = render();
  for (const key of Object.keys(FEATURE_LABELS)) {
    assert.ok(new RegExp(`>${FEATURE_LABELS[key]}<`).test(out), `부위 라벨 누락: ${FEATURE_LABELS[key]}`);
    assert.ok(out.includes(FIXTURE.features[key]), `부위 소견 누락: ${key}`);
  }
});

check('D3b', '회귀: 성격 강점·약점이 목록으로 렌더된다', () => {
  const out = render();
  for (const item of [...FIXTURE.personality.strengths, ...FIXTURE.personality.weaknesses]) {
    assert.ok(new RegExp(`<li[^>]*>${esc(item)}</li>`).test(out), `목록 항목 누락: ${item}`);
  }
  assert.ok(out.includes(FIXTURE.personality.summary), 'summary 누락');
  assert.ok(out.includes(FIXTURE.personality.social), 'social 누락');
});

check('D3c', '회귀: 사주 오행 뱃지와 4값이 렌더된다', () => {
  const out = render();
  assert.ok(new RegExp(`>${FIXTURE.saju.element}<`).test(out), '오행 글자가 개별 렌더되지 않음');
  for (const v of [FIXTURE.saju.elementReason, FIXTURE.saju.fortune, FIXTURE.saju.advice]) {
    assert.ok(out.includes(v), `사주 필드 누락: ${v}`);
  }
});

// ── D4. 섹션 순서 ─────────────────────────────────────────────────────
check('D4', '섹션 순서: 얼굴특징 → 성격 → 사주 → 어울리는이성 → 애정운', () => {
  const out = render();
  const at = (needle, label) => {
    const i = out.indexOf(needle);
    assert.ok(i >= 0, `순서 판정 기준을 못 찾음: ${label}`);
    return i;
  };
  const order = [
    at(FIXTURE.features.forehead, '얼굴 특징'),
    at(FIXTURE.personality.summary, '성격 해석'),
    at(FIXTURE.saju.elementReason, '사주 연관'),
    at(FIXTURE.love.idealPartner.type, '어울리는 이성'),
    at(FIXTURE.love.romance.tendency, '애정운'),
  ];
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i - 1] < order[i], `섹션 순서가 어긋남 (index ${i - 1} → ${i})`);
  }
});

// ── 가드레일 보조 검사 (최종 판정은 사람이 프롬프트를 읽고 한다) ──────
check('D5', '결과 화면에 외모 우열 표현이 섞여 있지 않다', () => {
  const out = render();
  for (const bad of ['미남', '미녀', '외모 수준', '외모가 뛰어난']) {
    assert.ok(!out.includes(bad), `외모 우열 표현이 화면 문구에 있음: ${bad}`);
  }
});

// ── 출력 ──────────────────────────────────────────────────────────────
let failed = 0;
console.log('\n실제 렌더 기반 검증 — 스프린트 3\n' + '─'.repeat(66));
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? '통과' : '실패'}  ${r.id.padEnd(5)} ${r.desc}`);
  if (!r.ok) console.log(`            └ ${r.note}`);
}
console.log('─'.repeat(66));
console.log(`${results.length}건 중 통과 ${results.length - failed} / 실패 ${failed}\n`);
process.exit(failed ? 1 : 0);
