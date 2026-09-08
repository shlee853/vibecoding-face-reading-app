interface NoFaceNoticeProps {
  message: string;
  onRetry: () => void;
}

/**
 * 얼굴 미인식(NO_FACE) 전용 안내. 일반 오류 배너와 달리 무엇이 문제이고
 * 어떤 사진을 올리면 되는지 안내하고, 다른 사진으로 다시 시도할 경로를 제공한다.
 */
export default function NoFaceNotice({ message, onRetry }: NoFaceNoticeProps) {
  return (
    <div className="bg-amber-500/20 border border-amber-400 text-amber-100 px-4 py-4 rounded-lg space-y-3">
      <div className="flex items-start gap-2">
        <span className="text-2xl">🙈</span>
        <div>
          <p className="font-bold text-white mb-1">얼굴을 찾지 못했어요</p>
          <p className="text-sm leading-relaxed">{message}</p>
        </div>
      </div>
      <ul className="text-sm list-disc list-inside space-y-1 text-amber-100">
        <li>얼굴이 화면 중앙에 크고 또렷하게 나온 사진을 사용해주세요</li>
        <li>정면을 바라보고, 조명이 밝은 사진일수록 잘 인식돼요</li>
        <li>선글라스나 마스크로 얼굴이 가려지지 않은 사진이 좋아요</li>
      </ul>
      <button
        onClick={onRetry}
        className="w-full bg-amber-500/30 hover:bg-amber-500/40 border border-amber-400 text-white font-medium py-2 px-4 rounded-lg transition"
      >
        다른 사진으로 다시 시도
      </button>
    </div>
  );
}
