'use client';

import { useRef, useState } from 'react';
import {
  ALLOWED_MIME_TYPES,
  MAX_IMAGE_BYTES,
  type AnalyzeErrorCode,
  type AnalyzeResponseBody,
  type FaceReading,
} from '@/lib/types';
import UploadPanel from './components/UploadPanel';
import ResultView from './components/ResultView';
import ErrorBanner from './components/ErrorBanner';
import NoFaceNotice from './components/NoFaceNotice';

/** 결과와 오류가 동시에 보이는 상태를 구조적으로 막기 위한 판별 유니온 */
type View =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'result'; result: FaceReading }
  | { phase: 'error'; code: AnalyzeErrorCode; message: string };

export default function Home() {
  const [preview, setPreview] = useState<string | null>(null);
  const [view, setView] = useState<View>({ phase: 'idle' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number])) {
      setView({
        phase: 'error',
        code: 'BAD_IMAGE_FORMAT',
        message: 'JPEG, PNG, WebP 형식의 이미지만 지원합니다. 다른 파일을 선택해주세요.',
      });
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      setView({
        phase: 'error',
        code: 'IMAGE_TOO_LARGE',
        message: '이미지 용량이 너무 큽니다. 4MB 이하의 사진을 선택해주세요.',
      });
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
      setView({ phase: 'idle' });
    };
    reader.readAsDataURL(file);
  };

  const handleClearPreview = () => {
    setPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleAnalyze = async () => {
    if (!preview) return;

    setView({ phase: 'loading' });

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: preview }),
      });

      const body: AnalyzeResponseBody = await response.json();

      if (body.ok) {
        setView({ phase: 'result', result: body.result });
      } else {
        setView({ phase: 'error', code: body.code, message: body.message });
      }
    } catch {
      setView({
        phase: 'error',
        code: 'UPSTREAM_FAILED',
        message: '분석 서버와 통신하는 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.',
      });
    }
  };

  /** 오류 화면에서 업로드 화면으로 돌아간다. 미리보기는 유지한다. */
  const handleBackToUpload = () => {
    setView({ phase: 'idle' });
  };

  /** 결과 화면에서 완전히 초기화한다 (B6): 미리보기·결과·오류를 모두 지운다. */
  const handleReset = () => {
    setPreview(null);
    setView({ phase: 'idle' });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const isLoading = view.phase === 'loading';

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
          {view.phase === 'result' ? (
            <div className="space-y-6">
              <ResultView preview={preview} result={view.result} />
              <button
                onClick={handleReset}
                className="w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-lg transition"
              >
                다시 분석하기
              </button>
            </div>
          ) : view.phase === 'error' && view.code === 'NO_FACE' ? (
            <NoFaceNotice message={view.message} onRetry={handleBackToUpload} />
          ) : (
            <>
              <UploadPanel
                preview={preview}
                isLoading={isLoading}
                fileInputRef={fileInputRef}
                onFileChange={handleFileChange}
                onClearPreview={handleClearPreview}
                onAnalyze={handleAnalyze}
              />
              {view.phase === 'error' && (
                <div className="mt-6">
                  <ErrorBanner message={view.message} onRetry={handleBackToUpload} />
                </div>
              )}
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
