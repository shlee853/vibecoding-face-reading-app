'use client';

import type { RefObject } from 'react';

interface UploadPanelProps {
  preview: string | null;
  isLoading: boolean;
  fileInputRef: RefObject<HTMLInputElement>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearPreview: () => void;
  onAnalyze: () => void;
}

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
}: UploadPanelProps) {
  return (
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
  );
}
