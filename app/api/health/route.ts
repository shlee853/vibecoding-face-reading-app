import { NextResponse } from 'next/server';

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
  const hasApiKey = Boolean(process.env.GEMINI_API_KEY);

  return NextResponse.json(
    {
      ok: hasApiKey,
      // 키가 없으면 서버는 떠 있어도 서비스는 불가능하다 — 그 사실을 분명히 한다.
      apiKey: hasApiKey ? 'configured' : 'missing',
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      node: process.version,
      env: process.env.NODE_ENV ?? 'unknown',
    },
    { status: hasApiKey ? 200 : 503 }
  );
}
