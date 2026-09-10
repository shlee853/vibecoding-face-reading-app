'use client';

/**
 * 업스트림에 보내기 전에 이미지를 줄인다.
 *
 * 왜: 업로드 상한이 4MB인데 관상 분석에 그만한 해상도가 필요하지 않다.
 * 큰 이미지는 전송·디코딩·모델 처리 시간을 모두 늘려 응답이 느려진다.
 * 긴 변을 1024px로 맞추면 얼굴 특징을 판단하기에 충분하면서 용량이 크게 준다.
 *
 * 브라우저 전용 모듈이다 — `lib/`에 두지 않는 이유는 그쪽이 서버·테스트 컴파일 대상이라
 * DOM 타입을 쓸 수 없기 때문이다.
 */

/** 긴 변의 목표 길이(px) */
export const MAX_UPLOAD_EDGE = 1024;

const JPEG_QUALITY = 0.85;

/** 원본 비율을 유지하면서 긴 변을 maxEdge 이하로 맞춘 크기를 구한다. */
function fitWithin(width: number, height: number, maxEdge: number) {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height, scaled: false };
  const ratio = maxEdge / longest;
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
    scaled: true,
  };
}

/**
 * 캔버스에 그려 JPEG data URL로 만든다.
 * mirror가 true면 좌우를 뒤집어 그린다(거울에 비친 모습 그대로 저장).
 */
function paint(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  mirror: boolean
): string | null {
  const { width, height } = fitWithin(sourceWidth, sourceHeight, MAX_UPLOAD_EDGE);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  if (mirror) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, 0, 0, width, height);

  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

/**
 * 비디오의 현재 프레임을 잡아 data URL로 만든다.
 * 프레임이 아직 없으면(videoWidth가 0) null.
 */
export function captureVideoFrame(
  video: HTMLVideoElement,
  options: { mirror?: boolean } = {}
): string | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  return paint(video, video.videoWidth, video.videoHeight, options.mirror ?? false);
}

/** File을 data URL 문자열로 읽는다. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('파일을 읽지 못했습니다.'));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 해석하지 못했습니다.'));
    img.src = dataUrl;
  });
}

/**
 * 선택한 파일을 축소된 JPEG data URL로 만든다.
 *
 * 축소가 필요 없거나(이미 작음) 어떤 단계든 실패하면 **원본 data URL을 그대로 돌려준다.**
 * 화질 최적화 때문에 업로드 자체가 실패하는 것이 훨씬 나쁘기 때문이다.
 */
export async function fileToUploadDataUrl(file: File): Promise<string> {
  const original = await readAsDataUrl(file);

  try {
    const img = await loadImage(original);
    const { scaled } = fitWithin(img.naturalWidth, img.naturalHeight, MAX_UPLOAD_EDGE);
    if (!scaled) return original;

    const resized = paint(img, img.naturalWidth, img.naturalHeight, false);
    return resized ?? original;
  } catch {
    return original;
  }
}
