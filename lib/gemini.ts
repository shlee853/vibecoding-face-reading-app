import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function analyzeFaceWithGemini(imageData: string) {
  const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

  const base64Data = imageData.split(',')[1];
  const mimeType = imageData.split(';')[0].split(':')[1] || 'image/jpeg';

  const response = await model.generateContent([
    {
      inlineData: {
        data: base64Data,
        mimeType: mimeType as any,
      },
    },
    '이 사진의 얼굴을 관상학적으로 분석해주세요.',
  ]);

  return response.response.text();
}
