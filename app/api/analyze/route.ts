import { NextRequest, NextResponse } from 'next/server';
import { validateImageDataUrl } from '@/lib/image';
import { createGeminiClient, analyzeFace } from '@/lib/gemini';
import { classifyUpstreamError, toErrorResponse } from '@/lib/errors';
import type { AnalyzeResponseBody } from '@/lib/types';

export async function POST(request: NextRequest): Promise<NextResponse<AnalyzeResponseBody>> {
  let image: unknown;
  try {
    const body = await request.json();
    image = body?.image;
  } catch {
    const { body, status } = toErrorResponse('NO_IMAGE');
    return NextResponse.json(body, { status });
  }

  const validation = validateImageDataUrl(image);
  if (!validation.ok) {
    const { body, status } = toErrorResponse(validation.code);
    return NextResponse.json(body, { status });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const { body, status } = toErrorResponse('NO_API_KEY');
    return NextResponse.json(body, { status });
  }

  try {
    const client = createGeminiClient(apiKey);
    const { parsed, elapsedMs } = await analyzeFace(
      { base64: validation.base64, mimeType: validation.mimeType },
      client
    );

    if (parsed.kind === 'ok') {
      return NextResponse.json({ ok: true, result: parsed.reading, elapsedMs }, { status: 200 });
    }

    if (parsed.kind === 'noface') {
      const { status } = toErrorResponse('NO_FACE');
      return NextResponse.json(
        { ok: false, code: 'NO_FACE', message: parsed.reason },
        { status }
      );
    }

    const { body, status } = toErrorResponse('UNPARSABLE_RESPONSE');
    return NextResponse.json(body, { status });
  } catch (error) {
    const code = classifyUpstreamError(error);
    const { body, status } = toErrorResponse(code);
    return NextResponse.json(body, { status });
  }
}
