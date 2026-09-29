/**
 * 분석 결과를 PDF로 저장한다. 브라우저에서만 동작한다(서버 렌더링 대상 아님).
 *
 * 화면 DOM을 캡처하는 대신 **pdf-lib로 텍스트·이미지를 직접 그린다**. 이전 버전은
 * html2canvas로 화면을 스크린샷했는데, 두 가지 문제가 있었다:
 *  1) html2canvas가 Tailwind의 최신 `rgb(r g b/var(...))` 색상 문법을 파싱하지 못해
 *     텍스트가 검정으로 나왔다(모니터 화면은 멀쩡한데 캡처만 깨지는 흔한 호환성 버그).
 *  2) 스크린샷이라 글자가 이미지일 뿐이다 — 확대하면 흐려지고, 선택·검색이 안 되고,
 *     파일도 쓸데없이 크다.
 * 직접 그리면 이 문제가 전부 사라지고, 상용 리포트처럼 타이포그래피·여백·페이지
 * 흐름을 우리가 온전히 통제할 수 있다. 대가는 한글 폰트를 직접 임베드해야 한다는
 * 것 — Pretendard(OFL 라이선스) TTF를 `public/fonts/`에 둔다. `subset: true`로 실제
 * 쓰인 글자만 넣어 파일을 줄이고 싶었지만, `@pdf-lib/fontkit`이 컴포지트 글리프
 * 기반 한글 폰트를 서브셋할 때 일부 글자가 빈칸으로 빠지는 버그가 있어(재현 확인)
 * 폰트 전체를 그대로 임베드한다 — 파일이 커지는 대신 모든 글자가 정확히 나온다.
 */
import type { PDFDocument, PDFFont, PDFPage, RGB } from 'pdf-lib';
import { FEATURE_LABELS, type FaceReading } from './types';

// pdf-lib/@pdf-lib/fontkit(수백 KB)는 이 함수를 실제로 쓸 때만 동적 import한다 —
// 그래서 아래 색상 상수도 pdf-lib의 rgb() 대신, 같은 모양의 리터럴을 직접 만든다
// (타입만 pdf-lib에서 가져오고, 런타임 값은 모듈 top-level에서 pdf-lib을 필요로 하지
// 않게 하기 위함 — 안 그러면 이 파일을 import하는 순간 pdf-lib이 즉시 번들에 딸려온다).
function rgbColor(red: number, green: number, blue: number): RGB {
  return { type: 'RGB', red, green, blue } as RGB;
}

// ---- 페이지 규격 (A4, pt 단위 — 1pt = 1/72inch) ----
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

// ---- 색상: 밝은 배경에 짙은 잉크색 본문 + 포인트 컬러 하나로 통일한다.
// (카드마다 색이 다르던 화면 UI와 달리, 인쇄물은 절제된 팔레트가 더 고급스럽다.)
const COLOR_INK = rgbColor(0.13, 0.14, 0.18);
const COLOR_SUBTLE = rgbColor(0.45, 0.47, 0.53);
const COLOR_ACCENT = rgbColor(0.43, 0.23, 0.66);
const COLOR_RULE = rgbColor(0.87, 0.85, 0.92);
const COLOR_WHITE = rgbColor(1, 1, 1);

const FONT_URLS = { regular: '/fonts/Pretendard-Regular.ttf', bold: '/fonts/Pretendard-Bold.ttf' };

/** 폰트는 한 번만 내려받아 세션 내내 재사용한다(수 MB짜리 파일이라 재요청을 피한다). */
let cachedFontBytes: Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> | null = null;

function loadFontBytes() {
  if (!cachedFontBytes) {
    cachedFontBytes = Promise.all([
      fetch(FONT_URLS.regular).then((r) => r.arrayBuffer()),
      fetch(FONT_URLS.bold).then((r) => r.arrayBuffer()),
    ]).then(([regular, bold]) => ({ regular, bold }));
  }
  return cachedFontBytes;
}

/** 페이지 하나를 그리는 동안의 커서 상태. 섹션을 그릴 때마다 넘겨받아 갱신한다. */
interface ReportContext {
  doc: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  page: PDFPage;
  /** 다음 내용이 그려질 y좌표(위쪽 기준). pdf-lib 좌표계는 아래에서 위로 증가한다. */
  cursorY: number;
}

function newPage(ctx: ReportContext): void {
  ctx.page = ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  ctx.cursorY = PAGE_HEIGHT - MARGIN;
}

/** 앞으로 그릴 내용에 최소 이만큼의 세로 공간이 필요하다 — 안 되면 새 페이지로 넘긴다. */
function ensureSpace(ctx: ReportContext, neededHeight: number): void {
  if (ctx.cursorY - neededHeight < MARGIN) {
    newPage(ctx);
  }
}

/**
 * 텍스트를 주어진 너비에 맞춰 줄 단위로 나눈다. 공백 기준으로 단어를 채워 넣다가,
 * 단어 하나가 통째로 너무 길면(드묾) 글자 단위로 강제로 자른다.
 */
function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';

  const flush = () => {
    if (current) lines.push(current);
    current = '';
  };

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }

    flush();

    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      current = word;
      continue;
    }

    let chunk = '';
    for (const ch of word) {
      const next = chunk + ch;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) {
        chunk = next;
      } else {
        if (chunk) lines.push(chunk);
        chunk = ch;
      }
    }
    current = chunk;
  }
  flush();

  return lines.length > 0 ? lines : [''];
}

function drawParagraph(
  ctx: ReportContext,
  text: string,
  opts: { font?: PDFFont; size?: number; color?: RGB; lineHeight?: number } = {}
): void {
  const font = opts.font ?? ctx.regular;
  const size = opts.size ?? 11;
  const color = opts.color ?? COLOR_INK;
  const lineHeight = opts.lineHeight ?? size * 1.6;

  for (const line of wrapLines(text, font, size, CONTENT_WIDTH)) {
    ensureSpace(ctx, lineHeight);
    ctx.page.drawText(line, { x: MARGIN, y: ctx.cursorY - size, size, font, color });
    ctx.cursorY -= lineHeight;
  }
}

/** 라벨(포인트 컬러, 작게) + 본문 문단. 얼굴 특징·조언 등 "라벨: 설명" 형태에 쓴다. */
function drawLabeledParagraph(ctx: ReportContext, label: string, body: string): void {
  ensureSpace(ctx, 16);
  ctx.page.drawText(label, { x: MARGIN, y: ctx.cursorY - 10, size: 10, font: ctx.bold, color: COLOR_ACCENT });
  ctx.cursorY -= 16;
  drawParagraph(ctx, body, { size: 11.5 });
  ctx.cursorY -= 10;
}

function drawBulletList(ctx: ReportContext, items: string[]): void {
  const bulletIndent = 14;
  for (const item of items) {
    const lines = wrapLines(item, ctx.regular, 11, CONTENT_WIDTH - bulletIndent);
    lines.forEach((line, i) => {
      ensureSpace(ctx, 17);
      if (i === 0) {
        ctx.page.drawText('•', { x: MARGIN, y: ctx.cursorY - 11, size: 11, font: ctx.regular, color: COLOR_ACCENT });
      }
      ctx.page.drawText(line, {
        x: MARGIN + bulletIndent,
        y: ctx.cursorY - 11,
        size: 11,
        font: ctx.regular,
        color: COLOR_INK,
      });
      ctx.cursorY -= 17;
    });
  }
}

/**
 * 강점/약점처럼 짧은 두 목록을 좌우로 나란히 찍는다. 두 컬럼 다 짧다는 전제하에
 * (LLM이 만드는 항목은 몇 단어 수준) 페이지 중간에 컬럼이 끊기는 경우는 다루지
 * 않는다 — 시작 전에 넉넉히 ensureSpace를 걸어 같은 페이지에 들어가게 한다.
 */
function drawTwoColumnBullets(
  ctx: ReportContext,
  left: { title: string; items: string[] },
  right: { title: string; items: string[] }
): void {
  const colGap = 24;
  const colWidth = (CONTENT_WIDTH - colGap) / 2;
  const leftX = MARGIN;
  const rightX = MARGIN + colWidth + colGap;

  const estimatedLines =
    left.items.reduce((n, item) => n + wrapLines(item, ctx.regular, 10.5, colWidth - 12).length, 0) +
    right.items.reduce((n, item) => n + wrapLines(item, ctx.regular, 10.5, colWidth - 12).length, 0);
  ensureSpace(ctx, 20 + estimatedLines * 15);

  ctx.page.drawText(left.title, { x: leftX, y: ctx.cursorY - 10, size: 10, font: ctx.bold, color: COLOR_ACCENT });
  ctx.page.drawText(right.title, { x: rightX, y: ctx.cursorY - 10, size: 10, font: ctx.bold, color: COLOR_ACCENT });
  const startY = ctx.cursorY - 16;

  const drawColumn = (items: string[], x: number): number => {
    let y = startY;
    for (const item of items) {
      const lines = wrapLines(item, ctx.regular, 10.5, colWidth - 12);
      lines.forEach((line, i) => {
        if (i === 0) {
          ctx.page.drawText('•', { x, y: y - 10.5, size: 10.5, font: ctx.regular, color: COLOR_ACCENT });
        }
        ctx.page.drawText(line, { x: x + 12, y: y - 10.5, size: 10.5, font: ctx.regular, color: COLOR_INK });
        y -= 15;
      });
    }
    return y;
  };

  const leftEndY = drawColumn(left.items, leftX);
  const rightEndY = drawColumn(right.items, rightX);
  ctx.cursorY = Math.min(leftEndY, rightEndY) - 10;
}

/** 섹션 제목 — 포인트 컬러 바 + 굵은 제목 + 얇은 구분선. */
function drawSectionHeading(ctx: ReportContext, title: string): void {
  ensureSpace(ctx, 40);
  const size = 15;
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.cursorY - size + 2,
    width: 4,
    height: size - 2,
    color: COLOR_ACCENT,
  });
  ctx.page.drawText(title, { x: MARGIN + 12, y: ctx.cursorY - size, size, font: ctx.bold, color: COLOR_INK });
  ctx.cursorY -= size + 8;
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.cursorY },
    end: { x: PAGE_WIDTH - MARGIN, y: ctx.cursorY },
    thickness: 0.75,
    color: COLOR_RULE,
  });
  ctx.cursorY -= 16;
}

/** 오행 글자를 담은 작은 원형 배지 + "오행 · X" 라벨, 그 아래 설명 문단. */
function drawSajuBadge(ctx: ReportContext, element: string, reason: string): void {
  ensureSpace(ctx, 40);
  const radius = 14;
  const cx = MARGIN + radius;
  const cy = ctx.cursorY - radius;

  ctx.page.drawCircle({ x: cx, y: cy, size: radius, color: COLOR_ACCENT });
  const charSize = 14;
  const charWidth = ctx.bold.widthOfTextAtSize(element, charSize);
  ctx.page.drawText(element, {
    x: cx - charWidth / 2,
    y: cy - charSize / 2 + 1,
    size: charSize,
    font: ctx.bold,
    color: COLOR_WHITE,
  });
  ctx.page.drawText(`오행 · ${element}`, {
    x: cx + radius + 10,
    y: cy - 5,
    size: 12,
    font: ctx.bold,
    color: COLOR_ACCENT,
  });

  ctx.cursorY -= radius * 2 + 14;
  drawParagraph(ctx, reason, { size: 11.5 });
  ctx.cursorY -= 4;
}

function drawCenteredText(
  ctx: ReportContext,
  text: string,
  font: PDFFont,
  size: number,
  color: RGB,
  gapAfter: number
): void {
  ensureSpace(ctx, size + gapAfter);
  const width = font.widthOfTextAtSize(text, size);
  ctx.page.drawText(text, { x: (PAGE_WIDTH - width) / 2, y: ctx.cursorY - size, size, font, color });
  ctx.cursorY -= size + gapAfter;
}

/** data URL 이미지를 원하는 가로세로 비율로 중앙 크롭해 PNG 바이트로 만든다. */
async function cropToAspectPng(
  dataUrl: string,
  aspect: number,
  outWidth: number,
  outHeight: number
): Promise<Uint8Array> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('이미지를 불러오지 못했습니다'));
    el.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) throw new Error('canvas 2D context를 만들지 못했습니다');

  const imgRatio = img.naturalWidth / img.naturalHeight;
  let sx = 0;
  let sy = 0;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  if (imgRatio > aspect) {
    sw = img.naturalHeight * aspect;
    sx = (img.naturalWidth - sw) / 2;
  } else {
    sh = img.naturalWidth / aspect;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx2d.drawImage(img, sx, sy, sw, sh, 0, 0, outWidth, outHeight);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('이미지를 PNG로 인코딩하지 못했습니다');
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * 표지 헤더: 사진 중앙 정렬 + 제목/부제/날짜를 그 아래 가운데 정렬로 배치한다.
 * (이전 버전에서 사진이 왼쪽으로 치우쳐 보이던 것과 달리, 전체를 페이지 중앙 축에
 * 맞춰 대칭적으로 배치한다.)
 */
async function drawCoverHeader(ctx: ReportContext, preview: string | null): Promise<void> {
  const photoWidth = 108;
  const photoAspect = 4 / 5; // 인물사진에 흔한 세로 비율
  const photoHeight = photoWidth / photoAspect;

  if (preview) {
    ensureSpace(ctx, photoHeight + 20);
    const cropped = await cropToAspectPng(preview, photoAspect, 480, 600);
    const img = await ctx.doc.embedPng(cropped);
    const x = (PAGE_WIDTH - photoWidth) / 2;
    const y = ctx.cursorY - photoHeight;
    ctx.page.drawRectangle({
      x: x - 3,
      y: y - 3,
      width: photoWidth + 6,
      height: photoHeight + 6,
      borderColor: COLOR_ACCENT,
      borderWidth: 1.5,
    });
    ctx.page.drawImage(img, { x, y, width: photoWidth, height: photoHeight });
    ctx.cursorY = y - 24;
  }

  drawCenteredText(ctx, '관상사주 분석 리포트', ctx.bold, 22, COLOR_INK, 12);
  drawCenteredText(ctx, 'AI가 분석한 관상과 사주 해석', ctx.regular, 12, COLOR_SUBTLE, 8);
  const dateStr = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  drawCenteredText(ctx, `생성일 · ${dateStr}`, ctx.regular, 10, COLOR_SUBTLE, 20);

  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.cursorY },
    end: { x: PAGE_WIDTH - MARGIN, y: ctx.cursorY },
    thickness: 1,
    color: COLOR_ACCENT,
  });
  ctx.cursorY -= 26;
}

/** 모든 내용을 다 그린 뒤, 각 페이지 하단에 페이지 번호와 안내 문구를 찍는다. */
function stampFooters(doc: PDFDocument, regular: PDFFont): void {
  const pages = doc.getPages();
  const disclaimer = '이 분석은 재미 목적입니다. 신뢰할 수 있는 출처로는 사용하지 마세요.';

  pages.forEach((page, i) => {
    const disclaimerSize = 8;
    const disclaimerWidth = regular.widthOfTextAtSize(disclaimer, disclaimerSize);
    page.drawText(disclaimer, {
      x: (PAGE_WIDTH - disclaimerWidth) / 2,
      y: MARGIN / 2 + 6,
      size: disclaimerSize,
      font: regular,
      color: COLOR_SUBTLE,
    });

    const pageLabel = `${i + 1} / ${pages.length}`;
    const pageLabelSize = 9;
    const pageLabelWidth = regular.widthOfTextAtSize(pageLabel, pageLabelSize);
    page.drawText(pageLabel, {
      x: (PAGE_WIDTH - pageLabelWidth) / 2,
      y: MARGIN / 2 - 8,
      size: pageLabelSize,
      font: regular,
      color: COLOR_SUBTLE,
    });
  });
}

function downloadPdfBytes(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function exportResultAsPdf(
  result: FaceReading,
  preview: string | null,
  filename: string
): Promise<void> {
  const [{ regular: regularBytes, bold: boldBytes }, { PDFDocument }, fontkitModule] = await Promise.all([
    loadFontBytes(),
    import('pdf-lib'),
    import('@pdf-lib/fontkit'),
  ]);

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkitModule.default);
  // subset: true는 켜지 않는다 — @pdf-lib/fontkit이 Pretendard처럼 한글 음절을
  // 컴포지트 글리프(획을 조합해 만드는 방식)로 최적화한 폰트를 서브셋하면, 일부
  // 글자가 빈칸으로 빠지는 게 알려진 버그다(실제로 재현 확인함). 파일이 커지는 대신
  // 폰트 전체를 그대로 넣어 이 문제를 피한다.
  const regular = await doc.embedFont(regularBytes, { subset: false });
  const bold = await doc.embedFont(boldBytes, { subset: false });

  const ctx: ReportContext = {
    doc,
    regular,
    bold,
    page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    cursorY: PAGE_HEIGHT - MARGIN,
  };

  await drawCoverHeader(ctx, preview);

  drawSectionHeading(ctx, '얼굴 특징');
  (Object.keys(FEATURE_LABELS) as (keyof typeof FEATURE_LABELS)[]).forEach((key) => {
    drawLabeledParagraph(ctx, FEATURE_LABELS[key], result.features[key]);
  });

  drawSectionHeading(ctx, '성격 해석');
  drawParagraph(ctx, result.personality.summary, { size: 11.5 });
  ctx.cursorY -= 6;
  drawTwoColumnBullets(
    ctx,
    { title: '강점', items: result.personality.strengths },
    { title: '약점', items: result.personality.weaknesses }
  );
  drawLabeledParagraph(ctx, '대인관계', result.personality.social);

  drawSectionHeading(ctx, '사주와의 연관');
  drawSajuBadge(ctx, result.saju.element, result.saju.elementReason);
  drawLabeledParagraph(ctx, '운세 경향', result.saju.fortune);
  drawLabeledParagraph(ctx, '조언', result.saju.advice);

  drawSectionHeading(ctx, '어울리는 이성');
  drawParagraph(ctx, result.love.idealPartner.type, { font: bold, size: 13.5 });
  ctx.cursorY -= 6;
  ensureSpace(ctx, 16);
  ctx.page.drawText('잘 맞는 성향', {
    x: MARGIN,
    y: ctx.cursorY - 10,
    size: 10,
    font: bold,
    color: COLOR_ACCENT,
  });
  ctx.cursorY -= 16;
  drawBulletList(ctx, result.love.idealPartner.traits);
  ctx.cursorY -= 6;
  drawLabeledParagraph(ctx, '근거', result.love.idealPartner.reason);

  drawSectionHeading(ctx, '애정운');
  drawLabeledParagraph(ctx, '연애 성향', result.love.romance.tendency);
  drawLabeledParagraph(ctx, '애정운 흐름', result.love.romance.fortune);
  drawLabeledParagraph(ctx, '주의할 점', result.love.romance.caution);

  stampFooters(doc, regular);

  const bytes = await doc.save();
  downloadPdfBytes(bytes, filename);
}
