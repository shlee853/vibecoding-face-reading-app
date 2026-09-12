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
  /** 우리가 실제로 쓰는 모델이 이 키로 접근 가능한가 */
  targetModel?: { name: string; available: boolean; supportsGenerate: boolean };
  /** 진단용 — 실제로 쓸 수 있는 모델 이름 몇 개 */
  sampleModels?: string[];
}

const MODELS_URL = 'https://generativelanguage.googleapis.com/v1/models';
const PROBE_TIMEOUT_MS = 10_000;

export async function probeUpstream(
  apiKey: string,
  targetModelName?: string
): Promise<UpstreamProbeResult> {
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
      let targetModel: UpstreamProbeResult['targetModel'];
      let sampleModels: string[] | undefined;

      try {
        const body = JSON.parse(text) as {
          models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
        };
        const models = Array.isArray(body.models) ? body.models : [];
        modelCount = models.length;

        // 생성이 가능한 모델만 추린다 — 임베딩 전용 모델은 분석에 쓸 수 없다.
        const generative = models
          .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
          .map((m) => (m.name ?? '').replace(/^models\//, ''))
          .filter(Boolean);
        sampleModels = generative.slice(0, 12);

        if (targetModelName) {
          const hit = models.find(
            (m) => (m.name ?? '').replace(/^models\//, '') === targetModelName
          );
          targetModel = {
            name: targetModelName,
            available: Boolean(hit),
            supportsGenerate: Boolean(hit?.supportedGenerationMethods?.includes('generateContent')),
          };
        }
      } catch {
        /* 본문 형식이 달라도 200이면 인증은 통과한 것이다 */
      }

      const modelProblem =
        targetModel && (!targetModel.available || !targetModel.supportsGenerate);

      return {
        reachable: true,
        authenticated: true,
        status: res.status,
        detail: modelProblem
          ? `키와 네트워크는 정상인데 **모델 "${targetModel!.name}" 을 쓸 수 없습니다** ` +
            `(존재: ${targetModel!.available}, 생성지원: ${targetModel!.supportsGenerate}). ` +
            `sampleModels 목록에서 쓸 수 있는 이름으로 바꿔야 합니다.`
          : '정상 — 네트워크와 키 모두 문제없습니다.',
        modelCount,
        targetModel,
        sampleModels,
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

/**
 * 실제 생성 호출을 최소 규모로 한 번 해 본다.
 *
 * 모델 목록 조회(무료)만으로는 잡히지 않는 것이 있다 — 생성 엔드포인트에서만 나는
 * 권한·할당량·정책 오류다. "키도 모델도 멀쩡한데 분석만 실패"할 때 마지막으로 남는 구간이다.
 *
 * 텍스트 몇 글자만 요청하므로 비용은 사실상 없다. 이미지는 보내지 않는다.
 */
export async function probeGenerate(
  apiKey: string,
  model: string
): Promise<{ ok: boolean; status: number | null; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: 8 },
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    if (res.ok) {
      return { ok: true, status: res.status, detail: '생성 호출 정상 — 분석 실패는 다른 원인입니다.' };
    }
    return { ok: false, status: res.status, detail: summarizeGoogleError(res.status, text) };
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
