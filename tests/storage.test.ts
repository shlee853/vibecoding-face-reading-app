/**
 * lib/storage.ts (신규) — saveResult() / loadResult() / clearResult() 계약 검증.
 * DOM/브라우저 localStorage가 없으므로 StorageLike를 주입받는 가짜 구현으로 테스트한다.
 * 대응 수락 기준: B1, B2, B3, B4
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { saveResult, loadResult, clearResult } from '../lib/storage';
import type { StorageLike } from '../lib/storage';
import {
  SAVED_RESULT_KEY,
  SAVED_RESULT_VERSION,
  MAX_SAVED_PREVIEW_BYTES,
} from '../lib/types';
import type { FaceReading } from '../lib/types';

// ---- 가짜 StorageLike 구현 --------------------------------------------------

/** 인메모리 Map 기반 가짜 스토리지. 정상 동작 경로 테스트에 쓴다. */
function makeMemoryStorage(initial: Record<string, string> = {}): StorageLike {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };
}

class FakeQuotaExceededError extends Error {
  constructor() {
    super('요청한 용량을 초과했습니다.');
    this.name = 'QuotaExceededError';
  }
}

/** setItem/removeItem이 모두 예외를 던지는 가짜 스토리지. B4용. */
function makeThrowingStorage(): StorageLike {
  return {
    getItem() {
      return null;
    },
    setItem() {
      throw new FakeQuotaExceededError();
    },
    removeItem() {
      throw new Error('removeItem도 실패했습니다.');
    },
  };
}

// ---- 현실적인 FaceReading 픽스처 (외모 우열 표현 없이 성향·분위기로 작성) --------

function makeFaceReading(): FaceReading {
  return {
    features: {
      forehead: '이마가 넓고 둥글어 지혜롭고 포용력 있는 인상입니다.',
      eyes: '눈매가 또렷하고 눈빛이 안정적이어서 신뢰감을 줍니다.',
      nose: '콧대가 곧고 코끝이 둥글어 재물운이 좋은 편입니다.',
      mouth: '입꼬리가 살짝 올라가 있어 사교적인 인상을 줍니다.',
      chin: '턱선이 둥글고 안정적이어서 말년운이 좋습니다.',
    },
    personality: {
      summary: '차분하고 신중하며 주변 사람을 잘 챙기는 성격입니다.',
      strengths: ['책임감이 강함', '포용력이 있음'],
      weaknesses: ['결정이 느릴 때가 있음'],
      social: '낯을 가리지만 친해지면 깊은 관계를 맺는 편입니다.',
    },
    saju: {
      element: '화',
      elementReason: '눈빛이 밝고 표정 변화가 풍부해 화의 기운과 닮았습니다.',
      fortune: '활동적인 시기와 안정적인 시기가 번갈아 오는 흐름입니다.',
      advice: '기세를 몰아붙이기보다 완급 조절에 신경 쓰세요.',
    },
    love: {
      idealPartner: {
        type: '차분하게 대화를 이끌어가는 사람',
        traits: ['배려심이 많음', '유머 감각이 있음'],
        reason: '눈매가 부드럽고 입꼬리가 편안하게 올라가 있어 정서적으로 안정된 상대와 잘 맞습니다.',
      },
      romance: {
        tendency: '표현이 서툴지만 한 번 마음을 열면 오래도록 다정하게 챙기는 편입니다.',
        fortune: '하반기에 새로운 인연이 자연스럽게 다가올 기운이 보입니다.',
        caution: '상대의 작은 신호를 놓치지 않도록 평소보다 관심을 기울이세요.',
      },
    },
  };
}

// ---- B1: 저장/불러오기 왕복 --------------------------------------------------

describe('saveResult / loadResult — 왕복 보존 (B1)', () => {
  test('저장 후 불러오면 result가 원본과 정확히 일치한다', () => {
    const storage = makeMemoryStorage();
    const result = makeFaceReading();

    saveResult(storage, result, '짧은-미리보기-데이터');
    const loaded = loadResult(storage);

    assert.notEqual(loaded, null);
    assert.deepEqual(loaded!.result, result);
  });

  test('savedAt은 숫자(epoch ms)다', () => {
    const storage = makeMemoryStorage();
    const before = Date.now();
    saveResult(storage, makeFaceReading(), null);
    const after = Date.now();

    const loaded = loadResult(storage);
    assert.notEqual(loaded, null);
    assert.equal(typeof loaded!.savedAt, 'number');
    assert.ok(Number.isFinite(loaded!.savedAt));
    // 저장 호출 전후 시각 범위 안에 있어야 한다 (미래/과거로 조작되지 않음).
    assert.ok(loaded!.savedAt >= before && loaded!.savedAt <= after);
  });

  test('version은 SAVED_RESULT_VERSION과 같다', () => {
    const storage = makeMemoryStorage();
    saveResult(storage, makeFaceReading(), null);
    const loaded = loadResult(storage);
    assert.notEqual(loaded, null);
    assert.equal(loaded!.version, SAVED_RESULT_VERSION);
  });

  test('SAVED_RESULT_KEY 아래에 저장된다 (다른 키로 새고 있지 않음)', () => {
    const storage = makeMemoryStorage();
    saveResult(storage, makeFaceReading(), '미리보기');
    assert.notEqual(storage.getItem(SAVED_RESULT_KEY), null);
  });
});

// ---- B2: preview 크기 상한 ----------------------------------------------------

describe('saveResult — preview 크기 상한 (B2)', () => {
  test('preview 길이가 상한 이하이면 preview가 그대로 보존된다', () => {
    const storage = makeMemoryStorage();
    const preview = 'a'.repeat(1000);
    const result = makeFaceReading();
    saveResult(storage, result, preview);

    const loaded = loadResult(storage);
    assert.notEqual(loaded, null);
    assert.equal(loaded!.preview, preview);
    assert.deepEqual(loaded!.result, result);
  });

  test('preview 길이가 정확히 상한(MAX_SAVED_PREVIEW_BYTES)이면 보존된다 (경계)', () => {
    const storage = makeMemoryStorage();
    const preview = 'a'.repeat(MAX_SAVED_PREVIEW_BYTES);
    const result = makeFaceReading();
    saveResult(storage, result, preview);

    const loaded = loadResult(storage);
    assert.notEqual(loaded, null);
    assert.equal(loaded!.preview, preview);
    assert.deepEqual(loaded!.result, result);
  });

  test('preview 길이가 상한보다 1 크면 preview는 null이 되지만 result는 보존된다 (경계)', () => {
    const storage = makeMemoryStorage();
    const preview = 'a'.repeat(MAX_SAVED_PREVIEW_BYTES + 1);
    const result = makeFaceReading();
    saveResult(storage, result, preview);

    const loaded = loadResult(storage);
    assert.notEqual(loaded, null);
    assert.equal(loaded!.preview, null);
    assert.deepEqual(loaded!.result, result);
  });

  test('preview가 처음부터 null이면 null로 저장/유지된다', () => {
    const storage = makeMemoryStorage();
    const result = makeFaceReading();
    saveResult(storage, result, null);

    const loaded = loadResult(storage);
    assert.notEqual(loaded, null);
    assert.equal(loaded!.preview, null);
    assert.deepEqual(loaded!.result, result);
  });
});

// ---- B3: loadResult 방어적 null 처리 --------------------------------------------

describe('loadResult — 저장 없음 / 손상 / 불일치는 예외 없이 null (B3)', () => {
  test('아무것도 저장돼 있지 않으면 null', () => {
    const storage = makeMemoryStorage();
    assert.doesNotThrow(() => {
      const loaded = loadResult(storage);
      assert.equal(loaded, null);
    });
  });

  test('저장된 값이 JSON으로 파싱되지 않으면 (\'{{{\')  null', () => {
    const storage = makeMemoryStorage({ [SAVED_RESULT_KEY]: '{{{' });
    assert.doesNotThrow(() => {
      const loaded = loadResult(storage);
      assert.equal(loaded, null);
    });
  });

  test('version이 SAVED_RESULT_VERSION과 다르면 (예: 999) null', () => {
    const envelope = {
      version: 999,
      savedAt: Date.now(),
      preview: null,
      result: makeFaceReading(),
    };
    const storage = makeMemoryStorage({ [SAVED_RESULT_KEY]: JSON.stringify(envelope) });
    assert.doesNotThrow(() => {
      const loaded = loadResult(storage);
      assert.equal(loaded, null);
    });
  });

  test('result에 love가 없으면 null', () => {
    const fullResult: any = makeFaceReading();
    delete fullResult.love;
    const envelope = {
      version: SAVED_RESULT_VERSION,
      savedAt: Date.now(),
      preview: null,
      result: fullResult,
    };
    const storage = makeMemoryStorage({ [SAVED_RESULT_KEY]: JSON.stringify(envelope) });
    assert.doesNotThrow(() => {
      const loaded = loadResult(storage);
      assert.equal(loaded, null);
    });
  });

  test('result에 features가 없으면 null (구조 검사가 다른 하위 키에도 적용됨)', () => {
    const fullResult: any = makeFaceReading();
    delete fullResult.features;
    const envelope = {
      version: SAVED_RESULT_VERSION,
      savedAt: Date.now(),
      preview: null,
      result: fullResult,
    };
    const storage = makeMemoryStorage({ [SAVED_RESULT_KEY]: JSON.stringify(envelope) });
    assert.doesNotThrow(() => {
      const loaded = loadResult(storage);
      assert.equal(loaded, null);
    });
  });

  test('result 자체가 아예 없으면 null', () => {
    const envelope = {
      version: SAVED_RESULT_VERSION,
      savedAt: Date.now(),
      preview: null,
    };
    const storage = makeMemoryStorage({ [SAVED_RESULT_KEY]: JSON.stringify(envelope) });
    assert.doesNotThrow(() => {
      const loaded = loadResult(storage);
      assert.equal(loaded, null);
    });
  });

  test('저장된 값이 JSON 배열이면 (객체가 아님) null', () => {
    const storage = makeMemoryStorage({ [SAVED_RESULT_KEY]: JSON.stringify([1, 2, 3]) });
    assert.doesNotThrow(() => {
      const loaded = loadResult(storage);
      assert.equal(loaded, null);
    });
  });
});

// ---- B4: 저장소가 예외를 던져도 saveResult/clearResult는 예외를 내지 않는다 -------

describe('saveResult / clearResult — 저장소 예외를 삼킨다 (B4)', () => {
  test('setItem이 QuotaExceededError를 던져도 saveResult는 예외를 밖으로 내지 않는다', () => {
    const storage = makeThrowingStorage();
    assert.doesNotThrow(() => {
      saveResult(storage, makeFaceReading(), '미리보기');
    });
  });

  test('removeItem이 던져도 clearResult는 예외를 밖으로 내지 않는다', () => {
    const storage = makeThrowingStorage();
    assert.doesNotThrow(() => {
      clearResult(storage);
    });
  });

  test('정상 스토리지에서 clearResult 호출 후에는 저장된 항목이 제거된다', () => {
    const storage = makeMemoryStorage();
    saveResult(storage, makeFaceReading(), '미리보기');
    assert.notEqual(storage.getItem(SAVED_RESULT_KEY), null);

    clearResult(storage);
    assert.equal(storage.getItem(SAVED_RESULT_KEY), null);
  });
});
