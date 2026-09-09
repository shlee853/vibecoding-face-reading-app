'use client';

import { useState, type RefObject } from 'react';
import CameraCapture from './CameraCapture';

interface UploadPanelProps {
  preview: string | null;
  isLoading: boolean;
  fileInputRef: RefObject<HTMLInputElement>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearPreview: () => void;
  onAnalyze: () => void;
  /** 카메라로 촬영한 사진을 preview로 전달한다. 파일 업로드와 동일하게 취급된다. */
  onCameraCapture: (dataUrl: string) => void;
}

type InputMode = 'upload' | 'camera';

/**
 * 이미지 업로드 및 분석 시작 화면. 순수 표시 컴포넌트 — fetch는 하지 않는다.
 */
export default function UploadPanel({
  preview,
  isLoading,
  fileInputRef,
  onFileChange,
  onClearPreview,
  onAnalyze,
  onCameraCapture,
}: UploadPanelProps) {
  const [mode, setMode] = useState<InputMode>('upload');

  const handleCameraCapture = (dataUrl: string) => {
    setMode('upload');
    onCameraCapture(dataUrl);
  };

  return (
    <>
      {/* 입력 수단 선택 */}
      {!preview && (
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode('upload')}
            disabled={isLoading}
            className={`flex-1 py-2 px-4 rounded-lg text-sm font-semibold transition ${
              mode === 'upload'
                ? 'bg-purple-600 text-white'
                : 'bg-white/10 text-gray-300 hover:bg-white/20'
            }`}
          >
            📁 사진 업로드
          </button>
          <button
            onClick={() => setMode('camera')}
            disabled={isLoading}
            className={`flex-1 py-2 px-4 rounded-lg text-sm font-semibold transition ${
              mode === 'camera'
                ? 'bg-purple-600 text-white'
                : 'bg-white/10 text-gray-300 hover:bg-white/20'
            }`}
          >
            📸 카메라 촬영
          </button>
        </div>
      )}

      {!preview && mode === 'camera' ? (
        <div className="mb-8">
          <CameraCapture onCapture={handleCameraCapture} onCancel={() => setMode('upload')} />
        </div>
      ) : (
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
                {!isLoading && (
                  <button
                    onClick={onClearPreview}
                    className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-lg text-sm"
                  >
                    ✕ 삭제
                  </button>
                )}
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
              accept="image/jpeg,image/png,image/webp"
              onChange={onFileChange}
              disabled={isLoading}
              className="hidden"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-4">
            <button
              onClick={onAnalyze}
              disabled={!preview || isLoading}
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
      )}
    </>
  );
}
