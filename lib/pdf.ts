/**
 * 분석 결과 DOM을 PDF로 저장한다. 브라우저에서만 동작한다(서버 렌더링 대상 아님).
 *
 * 구조화된 텍스트로 직접 그리지 않고 **DOM을 이미지로 캡처**하는 방식을 쓴다 — 이유는
 * jsPDF의 기본 폰트가 한글을 지원하지 않아, 직접 그리려면 폰트를 통째로 번들에 넣어야
 * 한다. 화면에 이미 브라우저가 올바르게 렌더링한 한글이 있으니 그걸 그대로 캡처하는
 * 편이 가볍고 화면과 100% 동일한 결과를 보장한다.
 */
export async function exportResultAsPdf(element: HTMLElement, filename: string): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  // scale: 2 — 화면 그대로(1x)면 인쇄/확대 시 글자가 흐리다. 앱 배경(slate-900→purple-900
  // 그라디언트)이 이미 DOM에 있지만, 캡처 여백이 생길 경우를 대비해 배경색을 명시한다.
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#1e1b3a',
  });

  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  // 결과가 A4 한 장보다 길 때가 흔하다 — 캔버스를 페이지 높이만큼 위로 밀어가며
  // 여러 페이지에 나눠 찍는다 (이미지를 잘라내지 않고, addImage의 y좌표만 옮긴다).
  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft > 0) {
    position -= pageHeight;
    pdf.addPage();
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  pdf.save(filename);
}
