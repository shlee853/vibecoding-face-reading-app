/**
 * 마지막 분석 결과를 브라우저에 임시 저장하는 순수 모듈.
 * localStorage/window를 최상위에서 직접 참조하지 않는다 — 호출자가 StorageLike를 주입한다.
 */
import {
  SAVED_RESULT_KEY,
  SAVED_RESULT_VERSION,
  MAX_SAVED_PREVIEW_BYTES,
} from './types';
import type { FaceReading, SavedResult } from './types';

/** localStorage와 호환되는 최소 인터페이스. 테스트는 인메모리 가짜를 주입한다. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 저장된 값의 얕은 구조 검사. features/personality/saju/love의 존재까지만 본다. */
function isValidFaceReadingShape(v: unknown): v is FaceReading {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return (
    !!obj.features &&
    typeof obj.features === 'object' &&
    !!obj.personality &&
    typeof obj.personality === 'object' &&
    !!obj.saju &&
    typeof obj.saju === 'object' &&
    !!obj.love &&
    typeof obj.love === 'object'
  );
}

function isValidSavedResultShape(v: unknown): v is SavedResult {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const obj = v as Record<string, unknown>;
  if (obj.version !== SAVED_RESULT_VERSION) return false;
  if (typeof obj.savedAt !== 'number') return false;
  if (obj.preview !== null && typeof obj.preview !== 'string') return false;
  if (!isValidFaceReadingShape(obj.result)) return false;
  return true;
}

/** 마지막 결과를 저장한다. 저장소가 예외를 던져도 밖으로 내지 않는다. */
export function saveResult(
  storage: StorageLike,
  result: FaceReading,
  preview: string | null
): void {
  try {
    const safePreview =
      preview !== null && preview.length > MAX_SAVED_PREVIEW_BYTES ? null : preview;

    const envelope: SavedResult = {
      version: SAVED_RESULT_VERSION,
      savedAt: Date.now(),
      preview: safePreview,
      result,
    };

    storage.setItem(SAVED_RESULT_KEY, JSON.stringify(envelope));
  } catch {
    // 용량 초과 등 저장 실패는 조용히 무시한다.
  }
}

/**
 * 저장된 결과를 불러온다. 저장 없음/파싱 실패/버전 불일치/구조 불량은
 * 모두 예외 없이 null을 반환한다.
 */
export function loadResult(storage: StorageLike): SavedResult | null {
  try {
    const raw = storage.getItem(SAVED_RESULT_KEY);
    if (raw === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    if (!isValidSavedResultShape(parsed)) return null;

    return parsed;
  } catch {
    return null;
  }
}

/** 저장된 결과를 지운다. 저장소가 예외를 던져도 밖으로 내지 않는다. */
export function clearResult(storage: StorageLike): void {
  try {
    storage.removeItem(SAVED_RESULT_KEY);
  } catch {
    // 제거 실패는 조용히 무시한다.
  }
}
