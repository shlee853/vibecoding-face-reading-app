import { NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/apikey';

/**
 * 배포된 서버가 살아 있고 제대로 설정됐는지 확인하는 엔드포인트.
 *
 * 배포 직후 가장 흔한 실패는 "서버는 떴는데 API 키가 없어서 모든 분석이 실패"하는 것이다.
 * 그걸 사용자가 사진을 올려보고 나서야 알게 되면 늦다. 여기서 먼저 드러낸다.
 *
 * **키 값 자체는 절대 내보내지 않는다.** 설정 여부만 알린다.
 */
export const dynamic = 'force-dynamic';

const startedAt = Date.now();

export function GET() {
  // 값의 존재만 보지 않고 **형식까지** 본다.
  // 예전에 자리표시자(한글)가 그대로 들어간 상태에서 "configured"라고 보고해
  // 모든 분석이 실패하는 동안 문제를 가린 적이 있다.
  const key = validateApiKey(process.env.GEMINI_API_KEY);

  return NextResponse.json(
    {
      ok: key.ok,
      apiKey: key.ok ? 'configured' : key.reason,
      ...(key.ok ? {} : { apiKeyDetail: key.detail }),
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      node: process.version,
      env: process.env.NODE_ENV ?? 'unknown',
    },
    { status: key.ok ? 200 : 503 }
  );
}
