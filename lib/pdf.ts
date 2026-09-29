/**
 * 분석 결과 DOM을 PDF로 저장한다. 브라우저에서만 동작한다(서버 렌더링 대상 아님).
 *
 * 구조화된 텍스트로 직접 그리지 않고 **DOM을 이미지로 캡처**하는 방식을 쓴다 — 이유는
 * jsPDF의 기본 폰트가 한글을 지원하지 않아, 직접 그리려면 폰트를 통째로 번들에 넣어야
 * 한다. 화면에 이미 브라우저가 올바르게 렌더링한 한글이 있으니 그걸 그대로 캡처하는
 * 편이 가볍고 화면과 100% 동일한 결과를 보장한다.
 *
 * 전체를 한 장의 캔버스로 찍어 페이지 높이만큼 기계적으로 잘라 배치하면, 문단 중간이나
 * 카드 경계 한복판에서 페이지가 끊긴다. 대신 결과 화면의 각 카드에 붙은
 * `data-pdf-section` 마커 단위로 따로 캡처해, 카드를 통째로 다음 페이지로 넘기는
 * 방식으로 조립한다 — 카드 하나가 꽉 찬 한 페이지보다 긴 드문 경우에만 어쩔 수 없이
 * 그 카드만 잘라 찍는다.
 */

const A4_MARGIN_MM = 10;
const SECTION_GAP_MM = 4;
const CAPTURE_BACKGROUND = '#1e1b3a';

export async function exportResultAsPdf(element: HTMLElement, filename: string): Promise<void> {
  const html2canvas = (await import('html2canvas')).default;
  const { jsPDF } = await import('jspdf');

  const sections = Array.from(element.querySelectorAll<HTMLElement>('[data-pdf-section]'));
  const targets = sections.length > 0 ? sections : [element];

  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pageWidth - A4_MARGIN_MM * 2;
  const maxContentHeight = pageHeight - A4_MARGIN_MM * 2;

  let cursorY = A4_MARGIN_MM;
  let hasContentOnPage = false;
  let forceNewPageForNext = false;

  for (const section of targets) {
    if (forceNewPageForNext) {
      pdf.addPage();
      cursorY = A4_MARGIN_MM;
      hasContentOnPage = false;
      forceNewPageForNext = false;
    }

    const canvas = await captureSection(html2canvas, section);
    const imgData = canvas.toDataURL('image/png');
    const imgHeight = (canvas.height * contentWidth) / canvas.width;

    if (imgHeight <= maxContentHeight) {
      // 지금 페이지에 남은 공간에 안 들어가면 카드째로 다음 페이지로 넘긴다 —
      // 카드 중간이 잘리는 일이 없다.
      if (hasContentOnPage && cursorY + imgHeight > pageHeight - A4_MARGIN_MM) {
        pdf.addPage();
        cursorY = A4_MARGIN_MM;
        hasContentOnPage = false;
      }
      pdf.addImage(imgData, 'PNG', A4_MARGIN_MM, cursorY, contentWidth, imgHeight);
      cursorY += imgHeight + SECTION_GAP_MM;
      hasContentOnPage = true;
      continue;
    }

    // 카드 하나가 페이지 하나보다 긴 드문 경우 — 이 카드만 여러 페이지로 잘라 찍는다.
    if (hasContentOnPage) {
      pdf.addPage();
    }
    let remaining = imgHeight;
    let sliceIndex = 0;
    while (remaining > 0) {
      if (sliceIndex > 0) pdf.addPage();
      const y = A4_MARGIN_MM - sliceIndex * maxContentHeight;
      pdf.addImage(imgData, 'PNG', A4_MARGIN_MM, y, contentWidth, imgHeight);
      remaining -= maxContentHeight;
      sliceIndex++;
    }
    // 다음 카드는 이 카드의 마지막 조각 아래 얼마나 공간이 남았는지 계산하지 않고,
    // 안전하게 새 페이지에서 다시 시작한다.
    forceNewPageForNext = true;
  }

  pdf.save(filename);
}

/**
 * 카드 하나를 캡처한다. 카드 안에 미리보기 사진(<img>)이 있으면, html2canvas가
 * object-fit을 반영하지 못해 사진이 찌그러지는 문제를 우회하기 위해 화면에 보이는
 * 비율 그대로 미리 크롭한 이미지로 바꿔 넣는다.
 */
async function captureSection(
  html2canvas: (typeof import('html2canvas'))['default'],
  section: HTMLElement
): Promise<HTMLCanvasElement> {
  const originalImg = section.querySelector('img');
  const croppedPreview =
    originalImg instanceof HTMLImageElement && originalImg.complete && originalImg.naturalWidth > 0
      ? cropImageToDisplayedBox(originalImg)
      : null;

  return html2canvas(section, {
    scale: 2,
    useCORS: true,
    backgroundColor: CAPTURE_BACKGROUND,
    onclone: (_document, clonedRoot) => {
      if (!croppedPreview) return;
      const clonedImg = clonedRoot.querySelector('img');
      if (clonedImg instanceof HTMLImageElement) {
        // 이미 화면 비율대로 중앙 크롭해 둔 이미지라 object-fit이 필요 없다 —
        // 그대로 박스를 채우기만 하면 된다.
        clonedImg.src = croppedPreview;
        clonedImg.style.objectFit = 'fill';
        clonedImg.removeAttribute('srcset');
      }
    },
  });
}

/**
 * <img>가 화면에서 실제로 차지하는 박스(object-fit: cover 적용 결과)에 맞춰 원본을
 * 중앙 기준으로 잘라낸 새 이미지를 만든다.
 *
 * html2canvas는 <img>의 object-fit을 지원하지 않아 원본을 박스 크기로 그냥 눌러
 * 늘려버린다 — 세로로 긴 인물 사진일수록 가로로 찌그러져 보이는 원인이었다. 캡처
 * 대상을 넘기기 전에 우리가 직접 크롭해서 이 문제를 피해간다.
 */
function cropImageToDisplayedBox(img: HTMLImageElement): string | null {
  const rect = img.getBoundingClientRect();
  const boxWidth = Math.max(1, Math.round(rect.width));
  const boxHeight = Math.max(1, Math.round(rect.height));

  const canvas = document.createElement('canvas');
  const outScale = 2; // 카드 본 캡처의 scale:2와 화질을 맞춘다.
  canvas.width = boxWidth * outScale;
  canvas.height = boxHeight * outScale;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const boxRatio = boxWidth / boxHeight;
  const imgRatio = img.naturalWidth / img.naturalHeight;

  let sx = 0;
  let sy = 0;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;

  if (imgRatio > boxRatio) {
    // 원본이 박스보다 가로로 길다 — 좌우를 잘라낸다.
    sw = img.naturalHeight * boxRatio;
    sx = (img.naturalWidth - sw) / 2;
  } else {
    // 원본이 박스보다 세로로 길다 — 위아래를 잘라낸다.
    sh = img.naturalWidth / boxRatio;
    sy = (img.naturalHeight - sh) / 2;
  }

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}
