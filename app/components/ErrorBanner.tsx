interface ErrorBannerProps {
  message: string;
  /** 개발 모드에서 서버가 채워 보내는 원인 상세. 프로덕션에서는 비어 있다. */
  detail?: string;
  onRetry: () => void;
}

/**
 * NO_FACE를 제외한 일반 오류를 보여주는 배너. 메시지는 서버가 준 문구를 그대로 표시한다.
 */
export default function ErrorBanner({ message, detail, onRetry }: ErrorBannerProps) {
  return (
    <div className="bg-red-500/20 border border-red-500 text-red-100 px-4 py-4 rounded-lg space-y-3">
      <p className="text-sm leading-relaxed">{message}</p>

      {detail && (
        <details className="text-left">
          <summary className="text-xs text-red-200/80 cursor-pointer select-none">
            개발자용 원인 보기
          </summary>
          <pre className="mt-2 text-[11px] leading-relaxed text-red-100/90 whitespace-pre-wrap break-all bg-black/30 rounded p-2">
            {detail}
          </pre>
        </details>
      )}
      <button
        onClick={onRetry}
        className="w-full bg-red-500/30 hover:bg-red-500/40 border border-red-400 text-white font-medium py-2 px-4 rounded-lg transition"
      >
        다시 시도
      </button>
    </div>
  );
}
