import { NextResponse, type NextRequest } from 'next/server';
import { validateApiKey } from '@/lib/apikey';
import { probeUpstream } from '@/lib/upstream-probe';

/**
 * 배포된 서버가 살아 있고 제대로 설정됐는지 확인하는 엔드포인트.
 *
 * 기본 호출은 프로세스 안의 사실만 본다(키 형식, 버전, 가동 시간).
 * `?deep=1` 을 붙이면 **업스트림까지 실제로 찔러본다** — 프로덕션에서는 오류 상세를
 * 사용자 화면에 싣지 않기 때문에, 이것이 없으면 "키가 유효하지 않다"는 증상만 보이고
 * 원인은 서버에 들어가 로그를 봐야만 알 수 있다.
 *
 * **키 값 자체는 어떤 경로로도 내보내지 않는다.**
 */
export const dynamic = 'force-dynamic';

const startedAt = Date.now();

/** 깊은 점검은 외부 호출을 동반하므로 최소 간격을 둔다 (남용·과금 방지). */
const DEEP_PROBE_MIN_INTERVAL_MS = 10_000;
let lastDeepProbeAt = 0;

export async function GET(request: NextRequest) {
  // 값의 존재만 보지 않고 **형식까지** 본다.
  // 예전에 자리표시자(한글)가 그대로 들어간 상태에서 "configured"라고 보고해
  // 모든 분석이 실패하는 동안 문제를 가린 적이 있다.
  const key = validateApiKey(process.env.GEMINI_API_KEY);

  const base = {
    ok: key.ok,
    apiKey: key.ok ? 'configured' : key.reason,
    ...(key.ok ? {} : { apiKeyDetail: key.detail }),
    // 어떤 코드가 돌고 있는지 밖에서 확인할 수 있어야 한다 — 빌드 시점에 박힌 값이다.
    version: process.env.APP_VERSION ?? 'unknown',
    builtAt: process.env.APP_BUILT_AT ?? 'unknown',
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    node: process.version,
    env: process.env.NODE_ENV ?? 'unknown',
  };

  const wantsDeep = request.nextUrl.searchParams.get('deep') === '1';
  if (!wantsDeep || !key.ok) {
    return NextResponse.json(base, { status: key.ok ? 200 : 503 });
  }

  const now = Date.now();
  if (now - lastDeepProbeAt < DEEP_PROBE_MIN_INTERVAL_MS) {
    const waitSec = Math.ceil((DEEP_PROBE_MIN_INTERVAL_MS - (now - lastDeepProbeAt)) / 1000);
    return NextResponse.json(
      { ...base, upstream: { skipped: `너무 잦은 점검입니다. ${waitSec}초 뒤에 다시 시도하세요.` } },
      { status: 200 }
    );
  }
  lastDeepProbeAt = now;

  // 모델 목록 조회라 토큰 비용이 들지 않는다.
  const upstream = await probeUpstream(process.env.GEMINI_API_KEY as string);

  return NextResponse.json(
    { ...base, ok: base.ok && upstream.authenticated, upstream },
    { status: upstream.authenticated ? 200 : 503 }
  );
}
