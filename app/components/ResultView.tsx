import { FEATURE_LABELS, type FaceReading } from '@/lib/types';

interface ResultViewProps {
  preview: string | null;
  result: FaceReading;
}

/**
 * 분석 결과를 부위별 · 항목별로 구조화해 보여주는 순수 표시 컴포넌트.
 */
export default function ResultView({ preview, result }: ResultViewProps) {
  return (
    <div className="space-y-6">
      {/* Preview */}
      {preview && (
        <div>
          <img
            src={preview}
            alt="Analyzed"
            className="w-full h-auto rounded-lg object-cover max-h-64"
          />
        </div>
      )}

      <div className="space-y-4">
        {/* 얼굴 특징 */}
        <div className="bg-purple-500/20 border border-purple-400 rounded-lg p-4">
          <h3 className="text-purple-200 font-bold mb-3">✨ 얼굴 특징</h3>
          <dl className="space-y-2">
            {(Object.keys(FEATURE_LABELS) as (keyof typeof FEATURE_LABELS)[]).map((key) => (
              <div key={key}>
                <dt className="text-purple-200 text-xs font-semibold">{FEATURE_LABELS[key]}</dt>
                <dd className="text-white text-sm leading-relaxed">{result.features[key]}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* 성격 해석 */}
        <div className="bg-blue-500/20 border border-blue-400 rounded-lg p-4">
          <h3 className="text-blue-200 font-bold mb-3">💫 성격 해석</h3>
          <p className="text-white text-sm leading-relaxed whitespace-pre-wrap mb-3">
            {result.personality.summary}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <p className="text-blue-200 text-xs font-semibold mb-1">강점</p>
              <ul className="list-disc list-inside space-y-1">
                {result.personality.strengths.map((item, i) => (
                  <li key={i} className="text-white text-sm">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-blue-200 text-xs font-semibold mb-1">약점</p>
              <ul className="list-disc list-inside space-y-1">
                {result.personality.weaknesses.map((item, i) => (
                  <li key={i} className="text-white text-sm">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-3">
            <p className="text-blue-200 text-xs font-semibold mb-1">대인관계</p>
            <p className="text-white text-sm leading-relaxed">{result.personality.social}</p>
          </div>
        </div>

        {/* 사주 연관 */}
        <div className="bg-pink-500/20 border border-pink-400 rounded-lg p-4">
          <h3 className="text-pink-200 font-bold mb-3">🎯 사주와의 연관</h3>
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-pink-400/40 border border-pink-300 text-white font-bold text-lg">
              {result.saju.element}
            </span>
            <span className="text-pink-100 text-sm">오행 · {result.saju.element}</span>
          </div>
          <p className="text-white text-sm leading-relaxed mb-3">{result.saju.elementReason}</p>
          <div className="mb-3">
            <p className="text-pink-200 text-xs font-semibold mb-1">운세 경향</p>
            <p className="text-white text-sm leading-relaxed">{result.saju.fortune}</p>
          </div>
          <div>
            <p className="text-pink-200 text-xs font-semibold mb-1">조언</p>
            <p className="text-white text-sm leading-relaxed">{result.saju.advice}</p>
          </div>
        </div>

        {/* 어울리는 이성 */}
        <div className="bg-rose-500/20 border border-rose-400 rounded-lg p-4">
          <h3 className="text-rose-200 font-bold mb-3">💘 어울리는 이성</h3>
          <p className="text-white text-base font-bold leading-relaxed mb-3">
            {result.love.idealPartner.type}
          </p>
          <div className="mb-3">
            <p className="text-rose-200 text-xs font-semibold mb-1">잘 맞는 성향</p>
            <ul className="list-disc list-inside space-y-1">
              {result.love.idealPartner.traits.map((item, i) => (
                <li key={i} className="text-white text-sm">
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-rose-200 text-xs font-semibold mb-1">근거</p>
            <p className="text-white text-sm leading-relaxed">{result.love.idealPartner.reason}</p>
          </div>
        </div>

        {/* 애정운 */}
        <div className="bg-amber-500/20 border border-amber-400 rounded-lg p-4">
          <h3 className="text-amber-200 font-bold mb-3">🌹 애정운</h3>
          <div className="mb-3">
            <p className="text-amber-200 text-xs font-semibold mb-1">연애 성향</p>
            <p className="text-white text-sm leading-relaxed">{result.love.romance.tendency}</p>
          </div>
          <div className="mb-3">
            <p className="text-amber-200 text-xs font-semibold mb-1">애정운 흐름</p>
            <p className="text-white text-sm leading-relaxed">{result.love.romance.fortune}</p>
          </div>
          <div>
            <p className="text-amber-200 text-xs font-semibold mb-1">주의할 점</p>
            <p className="text-white text-sm leading-relaxed">{result.love.romance.caution}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
