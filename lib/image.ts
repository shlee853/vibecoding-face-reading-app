import { ALLOWED_MIME_TYPES, MAX_IMAGE_BYTES, type ImageValidation } from './types';

const DATA_URL_RE = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,([\s\S]*)$/;

/** data URL 문자열에서 mimeType과 base64 페이로드를 분리한다. 형식이 아니면 null. */
export function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  if (typeof dataUrl !== 'string' || dataUrl.length === 0) return null;
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

/** base64 문자열이 디코딩됐을 때의 바이트 수를 추정한다 (패딩 고려). */
function base64ByteLength(base64: string): number {
  const len = base64.length;
  let padding = 0;
  if (base64.endsWith('==')) padding = 2;
  else if (base64.endsWith('=')) padding = 1;
  return Math.floor((len * 3) / 4) - padding;
}

/** 업로드된 이미지 데이터 URL을 검증한다. */
export function validateImageDataUrl(input: unknown): ImageValidation {
  if (typeof input !== 'string' || input.length === 0) {
    return { ok: false, code: 'NO_IMAGE' };
  }

  const parsed = parseDataUrl(input);
  if (!parsed) {
    return { ok: false, code: 'BAD_IMAGE_FORMAT' };
  }

  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(parsed.mimeType)) {
    return { ok: false, code: 'BAD_IMAGE_FORMAT' };
  }

  const byteLength = base64ByteLength(parsed.base64);
  if (byteLength > MAX_IMAGE_BYTES) {
    return { ok: false, code: 'IMAGE_TOO_LARGE' };
  }

  return { ok: true, mimeType: parsed.mimeType, base64: parsed.base64 };
}
