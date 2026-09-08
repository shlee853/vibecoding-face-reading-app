interface ErrorBannerProps {
  message: string;
  onRetry: () => void;
}

/**
 * NO_FACE를 제외한 일반 오류를 보여주는 배너. 메시지는 서버가 준 문구를 그대로 표시한다.
 */
export default function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <div className="bg-red-500/20 border border-red-500 text-red-100 px-4 py-4 rounded-lg space-y-3">
      <p className="text-sm leading-relaxed">{message}</p>
      <button
        onClick={onRetry}
        className="w-full bg-red-500/30 hover:bg-red-500/40 border border-red-400 text-white font-medium py-2 px-4 rounded-lg transition"
      >
        다시 시도
      </button>
    </div>
  );
}
