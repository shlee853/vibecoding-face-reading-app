/**
 * 요청 제한 — 공개 배포에서 API 비용이 폭주하는 것을 막는다.
 *
 * 이 앱은 요청 한 번에 Gemini 비전 호출이 **두 번** 일어난다. 공개 주소에 아무 제한 없이
 * 두면 한 사람이 새로고침만 반복해도 무료 한도가 몇 분 만에 사라지고, 유료 전환 후라면
 * 그대로 청구서가 된다. 그래서 이것은 배포의 부가 기능이 아니라 **선행 조건**이다.
 *
 * 단일 VM 배포를 전제로 메모리에만 상태를 둔다(Redis 없음).
 * 프로세스가 재시작되면 카운터도 사라지는데, 그건 남용 방지 목적에서 감수할 만한 손실이다.
 *
 * 시계를 주입받는 순수 함수로 만들어 테스트가 실제 시간을 기다리지 않아도 되게 했다.
 */

export interface RateLimitRule {
  /** 창의 길이(ms) */
  windowMs: number;
  /** 창 안에서 허용할 최대 요청 수 */
  max: number;
  /** 로그·진단에 쓰는 이름 */
  name: string;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** 거부됐을 때 몇 초 뒤에 다시 시도하면 되는가 */
  retryAfterSec: number;
  /** 어떤 규칙에 걸렸는가 (통과 시 null) */
  blockedBy: string | null;
}

/** 키별 요청 시각(ms) 목록. 슬라이딩 윈도우라 시각을 그대로 들고 있는다. */
export type HitStore = Map<string, number[]>;

export function createHitStore(): HitStore {
  return new Map();
}

/**
 * 기본 규칙.
 *
 * - 짧은 창: 연타와 새로고침 남용을 막는다.
 * - 하루 창: 한 사람이 하루에 쓸 수 있는 총량을 묶어 비용 상한을 만든다.
 *
 * 숫자는 "재미로 보는 서비스"를 전제로 넉넉하되 헤프지 않게 잡았다.
 * 실제 트래픽을 보고 조정하면 된다.
 */
export const DEFAULT_RULES: RateLimitRule[] = [
  { name: 'burst', windowMs: 5 * 60_000, max: 5 },
  { name: 'daily', windowMs: 24 * 60 * 60_000, max: 30 },
];

/** 가장 긴 창보다 오래된 기록은 어떤 규칙에도 쓰이지 않으므로 버린다. */
function prune(hits: number[], now: number, maxWindowMs: number): number[] {
  const cutoff = now - maxWindowMs;
  return hits.filter((t) => t > cutoff);
}

/**
 * 요청을 허용할지 판정한다. **허용된 경우에만** 기록을 남긴다 —
 * 거부된 요청까지 세면 한 번 막힌 사람이 영원히 못 들어오게 된다.
 */
export function checkRateLimit(
  store: HitStore,
  key: string,
  now: number,
  rules: RateLimitRule[] = DEFAULT_RULES
): RateLimitDecision {
  const maxWindowMs = Math.max(...rules.map((r) => r.windowMs));
  const hits = prune(store.get(key) ?? [], now, maxWindowMs);

  for (const rule of rules) {
    const inWindow = hits.filter((t) => t > now - rule.windowMs);
    if (inWindow.length >= rule.max) {
      // 가장 오래된 기록이 창을 빠져나가는 시점이 곧 다시 시도 가능한 시점이다.
      const oldest = inWindow[0];
      const retryAfterSec = Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1000));
      store.set(key, hits);
      return { allowed: false, retryAfterSec, blockedBy: rule.name };
    }
  }

  hits.push(now);
  store.set(key, hits);
  return { allowed: true, retryAfterSec: 0, blockedBy: null };
}

/**
 * 오래된 키를 버려 메모리가 무한히 늘지 않게 한다.
 * 장기 구동 서버에서 이걸 안 하면 방문자 수만큼 Map이 자란다.
 */
export function sweepHitStore(store: HitStore, now: number, maxWindowMs: number): number {
  let removed = 0;
  for (const [key, hits] of store) {
    const kept = prune(hits, now, maxWindowMs);
    if (kept.length === 0) {
      store.delete(key);
      removed += 1;
    } else if (kept.length !== hits.length) {
      store.set(key, kept);
    }
  }
  return removed;
}

/**
 * 요청에서 클라이언트 IP를 뽑는다.
 *
 * nginx 뒤에 두므로 `x-forwarded-for`의 **맨 앞** 값이 실제 클라이언트다.
 * 헤더가 없으면(직접 접속) 빈 문자열 대신 고정 키를 써서, 식별 불가한 요청들이
 * 제한을 통째로 우회하지 못하게 한다.
 */
export function clientKeyFromHeaders(headers: {
  get(name: string): string | null;
}): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}
