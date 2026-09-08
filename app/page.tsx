'use client';

import { useState, useRef } from 'react';
import Image from 'next/image';
import { analyzeFaceWithGemini } from '@/lib/gemini';

export default function Home() {
  const [image, setImage] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<{
    features: string;
    personality: string;
    fortune: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 파일 형식 확인
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setError('JPEG, PNG, WebP, GIF 형식의 이미지만 지원합니다.');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setImage(reader.result as string);
      setPreview(reader.result as string);
      setError(null);
      setResult(null);
    };
    reader.readAsDataURL(file);
  };

  const handleAnalyze = async () => {
    if (!image) {
      setError('사진을 선택해주세요.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '분석 중 오류가 발생했습니다.');
      }

      const data = await response.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setImage(null);
    setPreview(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">✨ 관상사주 분석</h1>
          <p className="text-gray-300">AI가 당신의 관상을 분석해 줍니다</p>
        </div>

        {/* Main Content */}
        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/20">
          {!result ? (
            <>
              {/* Image Upload Section */}
              <div className="mb-8">
                {preview ? (
                  <div className="relative">
                    <img
                      src={preview}
                      alt="Preview"
                      className="w-full h-auto rounded-lg object-cover max-h-96"
                    />
                    <button
                      onClick={() => {
                        setImage(null);
                        setPreview(null);
                        if (fileInputRef.current) {
                          fileInputRef.current.value = '';
                        }
                      }}
                      className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-lg text-sm"
                    >
                      ✕ 삭제
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-purple-400 hover:bg-white/5 transition"
                  >
                    <div className="text-4xl mb-4">📷</div>
                    <p className="text-white text-lg font-medium mb-2">사진을 업로드하세요</p>
                    <p className="text-gray-300 text-sm">클릭하거나 사진을 드래그해서 올려놓기</p>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageSelect}
                  className="hidden"
                />
              </div>

              {/* Error Message */}
              {error && (
                <div className="bg-red-500/20 border border-red-500 text-red-200 px-4 py-3 rounded-lg mb-6">
                  {error}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-4">
                <button
                  onClick={handleAnalyze}
                  disabled={!image || isLoading}
                  className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition"
                >
                  {isLoading ? (
                    <>
                      <span className="inline-block animate-spin mr-2">🔄</span>
                      분석 중...
                    </>
                  ) : (
                    '관상 분석하기'
                  )}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Result Section */}
              <div className="space-y-6">
                {/* Preview */}
                <div>
                  <img
                    src={preview!}
                    alt="Analyzed"
                    className="w-full h-auto rounded-lg object-cover max-h-64"
                  />
                </div>

                {/* Results */}
                <div className="space-y-4">
                  <div className="bg-purple-500/20 border border-purple-400 rounded-lg p-4">
                    <h3 className="text-purple-200 font-bold mb-2">✨ 얼굴 특징</h3>
                    <p className="text-white text-sm leading-relaxed whitespace-pre-wrap">{result.features}</p>
                  </div>

                  <div className="bg-blue-500/20 border border-blue-400 rounded-lg p-4">
                    <h3 className="text-blue-200 font-bold mb-2">💫 성격 해석</h3>
                    <p className="text-white text-sm leading-relaxed whitespace-pre-wrap">{result.personality}</p>
                  </div>

                  <div className="bg-pink-500/20 border border-pink-400 rounded-lg p-4">
                    <h3 className="text-pink-200 font-bold mb-2">🎯 사주와의 연관</h3>
                    <p className="text-white text-sm leading-relaxed whitespace-pre-wrap">{result.fortune}</p>
                  </div>
                </div>

                {/* Reset Button */}
                <button
                  onClick={handleReset}
                  className="w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-lg transition"
                >
                  다시 분석하기
                </button>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-8 text-gray-400 text-sm">
          <p>이 분석은 재미 목적입니다. 신뢰할 수 있는 출처로는 사용하지 마세요.</p>
        </div>
      </div>
    </main>
  );
}
