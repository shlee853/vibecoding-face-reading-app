/**
 * 업스트림(Gemini) 연결·인증 점검.
 *
 * 왜 필요한가: 프로덕션에서는 오류 상세를 사용자 화면에 싣지 않는다(내부 사정 노출 방지).
 * 그래서 "API 키가 유효하지 않습니다"가 떴을 때 **밖에서는 원인을 알 방법이 없고**,
 * 서버에 SSH로 들어가 로그를 봐야만 했다. 그 왕복이 진단을 크게 늦춘다.
 *
 * 이 점검은 **모델 목록 조회**(GET /v1/models)를 쓴다. 생성 호출이 아니라서
 * **토큰 비용이 들지 않으면서** 네트워크·키·권한을 한 번에 확인한다.
 *
 * 키 값은 어떤 경우에도 응답에 담지 않는다.
 */

export interface UpstreamProbeResult {
  /** 네트워크로 Google에 닿았는가 */
  reachable: boolean;
  /** 키가 받아들여졌는가 */
  authenticated: boolean;
  /** HTTP 상태 (닿지 못했으면 null) */
  status: number | null;
  /** 사람이 읽을 진단 문구. 키는 절대 포함하지 않는다. */
  detail: string;
  /** 조회에 성공했을 때 보이는 모델 수 */
  modelCount?: number;
}

const MODELS_URL = 'https://generativelanguage.googleapis.com/v1/models';
const PROBE_TIMEOUT_MS = 10_000;

export async function probeUpstream(apiKey: string): Promise<UpstreamProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const res = await fetch(MODELS_URL, {
      headers: { 'x-goog-api-key': apiKey },
      signal: controller.signal,
    });

    const text = await res.text();

    if (res.ok) {
      let modelCount: number | undefined;
      try {
        const body = JSON.parse(text) as { models?: unknown[] };
        modelCount = Array.isArray(body.models) ? body.models.length : undefined;
      } catch {
        /* 본문 형식이 달라도 200이면 인증은 통과한 것이다 */
      }
      return {
        reachable: true,
        authenticated: true,
        status: res.status,
        detail: '정상 — 네트워크와 키 모두 문제없습니다.',
        modelCount,
      };
    }

    // Google의 오류 본문에는 키가 들어있지 않다. 그대로 실어 진단에 쓴다.
    return {
      reachable: true,
      authenticated: false,
      status: res.status,
      detail: summarizeGoogleError(res.status, text),
    };
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    if (name === 'AbortError') {
      return {
        reachable: false,
        authenticated: false,
        status: null,
        detail: `${PROBE_TIMEOUT_MS}ms 안에 응답이 없습니다. 서버의 외부 연결이 느리거나 막혀 있습니다.`,
      };
    }
    const msg = (e as { message?: string } | null)?.message ?? String(e);
    return {
      reachable: false,
      authenticated: false,
      status: null,
      detail: `Google에 닿지 못했습니다: ${msg.slice(0, 200)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 상태 코드별로 "그래서 무엇을 고쳐야 하는가"를 덧붙인다. */
function summarizeGoogleError(status: number, body: string): string {
  const raw = body.replace(/\s+/g, ' ').slice(0, 300);

  if (status === 400 || status === 401) {
    return `키가 거부됐습니다(HTTP ${status}). 키 값이 잘못됐거나 만료됐을 수 있습니다. 원문: ${raw}`;
  }
  if (status === 403) {
    return (
      `권한이 거부됐습니다(HTTP 403). 흔한 원인: ` +
      `① 키에 IP/리퍼러 제한이 걸려 이 서버에서 쓸 수 없음 ` +
      `② 프로젝트에서 Generative Language API가 활성화되지 않음. 원문: ${raw}`
    );
  }
  if (status === 429) {
    return `할당량을 초과했습니다(HTTP 429). 무료 한도를 다 썼을 수 있습니다. 원문: ${raw}`;
  }
  if (status >= 500) {
    return `Google 쪽 일시적 오류입니다(HTTP ${status}). 원문: ${raw}`;
  }
  return `예상 밖 응답(HTTP ${status}). 원문: ${raw}`;
}
