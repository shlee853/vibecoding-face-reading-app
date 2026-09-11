/**
 * API 키 형식 검증.
 *
 * 왜 필요한가: 키는 HTTP 헤더에 실린다. 헤더 값은 Latin-1(0~255)만 담을 수 있어서,
 * 한글 같은 문자가 섞이면 **요청이 만들어지기도 전에** 이런 예외가 난다:
 *
 *   Cannot convert argument to a ByteString because the character at index 0
 *   has a value of 48156 which is greater than 255.
 *
 * 실제로 배포 중에 안내 문서의 자리표시자(`발급받은키`)를 그대로 환경변수에 넣어
 * 모든 분석이 실패한 적이 있다. 그때 헬스체크는 "값이 있다"는 이유로 정상이라고 보고했고,
 * 앱은 실패할 게 뻔한 요청을 네 번이나 보냈다.
 *
 * 그래서 **부팅·요청 전에 형식을 먼저 본다.** 값의 존재만 확인하는 것은 검증이 아니다.
 */

export type ApiKeyStatus =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'non-ascii' | 'too-short' | 'placeholder'; detail: string };

/** 자리표시자를 그대로 둔 흔한 경우들 */
const PLACEHOLDER_HINTS = [
  'your_api_key',
  'your-api-key',
  'here',
  'xxx',
  'changeme',
  'replace',
];

export function validateApiKey(raw: string | undefined | null): ApiKeyStatus {
  const key = (raw ?? '').trim();

  if (key.length === 0) {
    return { ok: false, reason: 'missing', detail: 'GEMINI_API_KEY가 설정되지 않았습니다.' };
  }

  // ★ 가장 중요한 검사. 헤더에 못 싣는 문자가 있으면 호출 자체가 불가능하다.
  const nonAscii = [...key].find((ch) => ch.codePointAt(0)! > 126 || ch.codePointAt(0)! < 32);
  if (nonAscii) {
    return {
      ok: false,
      reason: 'non-ascii',
      detail:
        `키에 ASCII가 아닌 문자("${nonAscii}")가 들어 있습니다. ` +
        '안내 문서의 자리표시자를 실제 키로 바꾸지 않았을 가능성이 큽니다.',
    };
  }

  if (PLACEHOLDER_HINTS.some((hint) => key.toLowerCase().includes(hint))) {
    return {
      ok: false,
      reason: 'placeholder',
      detail: '키가 예시 문자열로 보입니다. 실제 발급받은 키로 바꿔주세요.',
    };
  }

  // 실제 Gemini 키는 30자를 훌쩍 넘는다. 짧으면 잘못 붙여넣은 것이다.
  if (key.length < 20) {
    return {
      ok: false,
      reason: 'too-short',
      detail: `키가 너무 짧습니다(${key.length}자). 잘려서 붙여넣어졌는지 확인해주세요.`,
    };
  }

  return { ok: true };
}
