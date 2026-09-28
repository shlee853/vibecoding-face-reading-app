/**
 * 업스트림(OpenRouter) 연결·인증 점검.
 *
 * 왜 필요한가: 프로덕션에서는 오류 상세를 사용자 화면에 싣지 않는다(내부 사정 노출 방지).
 * 그래서 "API 키가 유효하지 않습니다"가 떴을 때 **밖에서는 원인을 알 방법이 없고**,
 * 서버에 SSH로 들어가 로그를 봐야만 했다. 그 왕복이 진단을 크게 늦춘다.
 *
 * 이 점검은 **키 상태 조회**(GET /api/v1/auth/key)를 쓴다. 생성 호출이 아니라서
 * **토큰 비용이 들지 않으면서** 네트워크·키를 한 번에 확인한다.
 *
 * 키 값은 어떤 경우에도 응답에 담지 않는다.
 */

export interface UpstreamProbeResult {
  /** 네트워크로 OpenRouter에 닿았는가 */
  reachable: boolean;
  /** 키가 받아들여졌는가 */
  authenticated: boolean;
  /** HTTP 상태 (닿지 못했으면 null) */
  status: number | null;
  /** 사람이 읽을 진단 문구. 키는 절대 포함하지 않는다. */
  detail: string;
  /** 무료 티어 키인가 — 데이터 로깅/학습 사용 가능성을 상기시키는 용도 */
  isFreeTier?: boolean;
  /** 이번 달 남은 한도(있는 경우) */
  limitRemaining?: number | null;
}

const AUTH_KEY_URL = 'https://openrouter.ai/api/v1/auth/key';
const CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
const PROBE_TIMEOUT_MS = 10_000;

export async function probeUpstream(apiKey: string): Promise<UpstreamProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const res = await fetch(AUTH_KEY_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });

    const text = await res.text();

    if (res.ok) {
      let isFreeTier: boolean | undefined;
      let limitRemaining: number | null | undefined;

      try {
        const body = JSON.parse(text) as {
          data?: { is_free_tier?: boolean; limit_remaining?: number | null };
        };
        isFreeTier = body.data?.is_free_tier;
        limitRemaining = body.data?.limit_remaining;
      } catch {
        /* 본문 형식이 달라도 200이면 인증은 통과한 것이다 */
      }

      return {
        reachable: true,
        authenticated: true,
        status: res.status,
        detail: '정상 — 네트워크와 키 모두 문제없습니다.',
        isFreeTier,
        limitRemaining,
      };
    }

    return {
      reachable: true,
      authenticated: false,
      status: res.status,
      detail: summarizeOpenRouterError(res.status, text),
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
      detail: `OpenRouter에 닿지 못했습니다: ${msg.slice(0, 200)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 실제 생성 호출을 최소 규모로 한 번 해 본다.
 *
 * 키 상태 조회(무료)만으로는 잡히지 않는 것이 있다 — 생성 엔드포인트에서만 나는
 * 모델 접근·요청 제한 오류다. "키는 멀쩡한데 분석만 실패"할 때 마지막으로 남는 구간이다.
 *
 * 텍스트 몇 글자만 요청하므로 비용은 사실상 없다(무료 티어면 0원). 이미지는 보내지 않는다.
 */
export async function probeGenerate(
  apiKey: string,
  model: string
): Promise<{ ok: boolean; status: number | null; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const res = await fetch(CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 8,
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    if (res.ok) {
      return { ok: true, status: res.status, detail: '생성 호출 정상 — 분석 실패는 다른 원인입니다.' };
    }
    return { ok: false, status: res.status, detail: summarizeOpenRouterError(res.status, text) };
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    const msg = (e as { message?: string } | null)?.message ?? String(e);
    return {
      ok: false,
      status: null,
      detail:
        name === 'AbortError'
          ? `${PROBE_TIMEOUT_MS}ms 안에 응답이 없습니다.`
          : `생성 호출에 실패했습니다: ${msg.slice(0, 200)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 상태 코드별로 "그래서 무엇을 고쳐야 하는가"를 덧붙인다. */
function summarizeOpenRouterError(status: number, body: string): string {
  const raw = body.replace(/\s+/g, ' ').slice(0, 300);

  if (status === 401) {
    return `키가 거부됐습니다(HTTP 401). 키 값이 잘못됐거나 만료됐을 수 있습니다. 원문: ${raw}`;
  }
  if (status === 402) {
    return `크레딧이 부족합니다(HTTP 402). 무료 티어 한도를 다 썼거나 결제가 필요합니다. 원문: ${raw}`;
  }
  if (status === 403) {
    return `권한이 거부됐습니다(HTTP 403). 키에 제한이 걸려 있거나 이 모델에 접근할 수 없습니다. 원문: ${raw}`;
  }
  if (status === 404) {
    return `모델을 찾을 수 없습니다(HTTP 404). 모델 이름(예: google/gemma-4-26b-a4b-it:free)을 확인하세요. 원문: ${raw}`;
  }
  if (status === 429) {
    return `요청 제한을 초과했습니다(HTTP 429). 무료 티어는 특히 엄격합니다. 원문: ${raw}`;
  }
  if (status >= 500) {
    return `OpenRouter 쪽 일시적 오류입니다(HTTP ${status}). 원문: ${raw}`;
  }
  return `예상 밖 응답(HTTP ${status}). 원문: ${raw}`;
}
