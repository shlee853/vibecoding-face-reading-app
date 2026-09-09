import { ELEMENTS, type FaceReading, type ParseResult } from './types';

const DEFAULT_NOFACE_REASON =
  '사진에서 얼굴을 인식할 수 없습니다. 정면이 잘 보이는 밝은 사진으로 다시 시도해 주세요.';

/**
 * raw 텍스트에서 첫 번째 JSON 객체를 회수한다.
 * ```json 펜스, 일반 펜스, raw JSON, 산문에 둘러싸인 JSON을 모두 지원한다.
 * 중괄호는 문자열 리터럴/이스케이프를 인지하며 직접 세어 짝을 맞춘다.
 */
export function extractJsonBlock(raw: string): unknown | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;

  const start = raw.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = raw.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }

  // 끝까지 갔는데 짝이 맞지 않음
  return null;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function normalizeStringArray(v: unknown): string[] | null {
  if (typeof v === 'string') {
    return isNonEmptyString(v) ? [v] : null;
  }
  if (Array.isArray(v) && v.every((item) => typeof item === 'string')) {
    return v as string[];
  }
  return null;
}

function normalizeElement(v: unknown): (typeof ELEMENTS)[number] | null {
  if (typeof v !== 'string') return null;
  for (const el of ELEMENTS) {
    if (v.includes(el)) return el;
  }
  return null;
}

/** Gemini 원문 텍스트를 구조화된 결과로 판정한다. */
export function parseAnalysis(raw: string): ParseResult {
  const value = extractJsonBlock(raw);

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { kind: 'unparsable', raw };
  }

  const obj = value as Record<string, unknown>;

  if (obj.faceDetected === false) {
    const reason = isNonEmptyString(obj.reason) ? (obj.reason as string) : DEFAULT_NOFACE_REASON;
    return { kind: 'noface', reason };
  }

  const features = obj.features as Record<string, unknown> | undefined;
  const personality = obj.personality as Record<string, unknown> | undefined;
  const saju = obj.saju as Record<string, unknown> | undefined;

  if (
    !features ||
    typeof features !== 'object' ||
    !isNonEmptyString(features.forehead) ||
    !isNonEmptyString(features.eyes) ||
    !isNonEmptyString(features.nose) ||
    !isNonEmptyString(features.mouth) ||
    !isNonEmptyString(features.chin)
  ) {
    return { kind: 'unparsable', raw };
  }

  if (!personality || typeof personality !== 'object') {
    return { kind: 'unparsable', raw };
  }

  const strengths = normalizeStringArray(personality.strengths);
  const weaknesses = normalizeStringArray(personality.weaknesses);

  if (
    !isNonEmptyString(personality.summary) ||
    !strengths ||
    !weaknesses ||
    !isNonEmptyString(personality.social)
  ) {
    return { kind: 'unparsable', raw };
  }

  if (!saju || typeof saju !== 'object') {
    return { kind: 'unparsable', raw };
  }

  const element = normalizeElement(saju.element);

  if (
    !element ||
    !isNonEmptyString(saju.elementReason) ||
    !isNonEmptyString(saju.fortune) ||
    !isNonEmptyString(saju.advice)
  ) {
    return { kind: 'unparsable', raw };
  }

  const love = obj.love as Record<string, unknown> | undefined;

  if (!love || typeof love !== 'object') {
    return { kind: 'unparsable', raw };
  }

  const idealPartner = love.idealPartner as Record<string, unknown> | undefined;
  const romance = love.romance as Record<string, unknown> | undefined;

  if (!idealPartner || typeof idealPartner !== 'object') {
    return { kind: 'unparsable', raw };
  }

  const traits = normalizeStringArray(idealPartner.traits);

  if (
    !isNonEmptyString(idealPartner.type) ||
    !traits ||
    traits.length === 0 ||
    !isNonEmptyString(idealPartner.reason)
  ) {
    return { kind: 'unparsable', raw };
  }

  if (!romance || typeof romance !== 'object') {
    return { kind: 'unparsable', raw };
  }

  if (
    !isNonEmptyString(romance.tendency) ||
    !isNonEmptyString(romance.fortune) ||
    !isNonEmptyString(romance.caution)
  ) {
    return { kind: 'unparsable', raw };
  }

  const reading: FaceReading = {
    features: {
      forehead: features.forehead as string,
      eyes: features.eyes as string,
      nose: features.nose as string,
      mouth: features.mouth as string,
      chin: features.chin as string,
    },
    personality: {
      summary: personality.summary as string,
      strengths,
      weaknesses,
      social: personality.social as string,
    },
    saju: {
      element,
      elementReason: saju.elementReason as string,
      fortune: saju.fortune as string,
      advice: saju.advice as string,
    },
    love: {
      idealPartner: {
        type: idealPartner.type as string,
        traits,
        reason: idealPartner.reason as string,
      },
      romance: {
        tendency: romance.tendency as string,
        fortune: romance.fortune as string,
        caution: romance.caution as string,
      },
    },
  };

  return { kind: 'ok', reading };
}
