import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function POST(request: NextRequest) {
  try {
    const { image } = await request.json();

    if (!image) {
      return NextResponse.json(
        { error: '이미지가 필요합니다.' },
        { status: 400 }
      );
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'API 키가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    // Base64 이미지를 Gemini API 형식으로 변환
    const base64Data = image.split(',')[1];
    const mimeType = image.split(';')[0].split(':')[1] || 'image/jpeg';

    const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

    // 관상 분석 프롬프트
    const analysisPrompt = `당신은 관상과 사주에 전문가입니다.

이 사진의 얼굴을 보고 다음 세 가지를 한국어로 자세히 분석해주세요:

1. **얼굴 특징 분석** (이마, 눈, 코, 입, 턱의 특징을 구체적으로):
   - 이마의 넓이와 형태
   - 눈의 모양과 크기
   - 코의 높이와 형태
   - 입의 모양과 입술의 두께
   - 턱의 형태

2. **성격 해석** (관상학에 따른 성격 특징):
   - 주요 성격 특징
   - 강점과 약점
   - 대인관계 스타일

3. **사주와의 연관** (관상과 사주의 연결):
   - 오행(목화토금수)과의 연관성
   - 예상되는 운세 경향
   - 주의할 점과 발전 방향

각 섹션을 명확하게 구분해서 작성해주세요.`;

    const response = await model.generateContent([
      {
        inlineData: {
          data: base64Data,
          mimeType: mimeType as any,
        },
      },
      analysisPrompt,
    ]);

    const analysisText = response.response.text();

    // 응답을 섹션별로 파싱
    const parts = analysisText.split(/\*\*\d\.\s+/);

    let features = '';
    let personality = '';
    let fortune = '';

    if (parts.length >= 2) {
      features = parts[1]?.split('\n').slice(1).join('\n').trim() || '';
    }
    if (parts.length >= 3) {
      personality = parts[2]?.split('\n').slice(1).join('\n').trim() || '';
    }
    if (parts.length >= 4) {
      fortune = parts[3]?.split('\n').slice(1).join('\n').trim() || '';
    }

    // 파싱 실패 시 전체 텍스트 사용
    if (!features || !personality || !fortune) {
      const lines = analysisText.split('\n');
      features = lines.slice(0, Math.floor(lines.length / 3)).join('\n');
      personality = lines.slice(Math.floor(lines.length / 3), Math.floor(lines.length * 2 / 3)).join('\n');
      fortune = lines.slice(Math.floor(lines.length * 2 / 3)).join('\n');
    }

    return NextResponse.json({
      features: features.trim(),
      personality: personality.trim(),
      fortune: fortune.trim(),
    });
  } catch (error) {
    console.error('Error analyzing image:', error);

    let errorMessage = '분석 중 오류가 발생했습니다.';
    if (error instanceof Error) {
      if (error.message.includes('API key')) {
        errorMessage = 'API 키가 유효하지 않습니다. 환경 변수를 확인해주세요.';
      } else if (error.message.includes('invalid image')) {
        errorMessage = '유효하지 않은 이미지입니다. 다른 이미지를 시도해주세요.';
      } else {
        errorMessage = error.message;
      }
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
