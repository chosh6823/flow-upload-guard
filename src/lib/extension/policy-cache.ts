/**
 * 차단 정책 캐시의 저장소.
 *
 * 이 모듈은 의도적으로 아무것도 import 하지 않는다.
 * repository(쓰기 경로)와 policy(읽기 경로)가 둘 다 캐시를 건드려야 하는데,
 * 캐시를 policy 안에 두면 repository → policy → repository 순환 참조가 생긴다.
 * 상태만 떼어내면 의존이 한 방향으로 정리된다.
 *
 *    repository ──▶ policy-cache ◀── policy
 */

export interface PolicyCacheEntry {
  blocked: Set<string>;
  loadedAt: number;
}

let cache: PolicyCacheEntry | null = null;

export function readPolicyCache(ttlMs: number): Set<string> | null {
  if (!cache) return null;
  if (Date.now() - cache.loadedAt >= ttlMs) return null;
  return cache.blocked;
}

export function writePolicyCache(blocked: Set<string>): void {
  cache = { blocked, loadedAt: Date.now() };
}

/**
 * 정책이 바뀌는 모든 경로에서 호출한다.
 *
 * 보안 정책 캐시에는 방향성이 있다:
 *   - "차단해야 하는데 캐시가 낡아서 통과" → 사고
 *   - "해제했는데 캐시가 낡아서 몇 초 더 막힘" → 불편
 * 두 실패의 무게가 다르므로 무효화를 1차 수단으로 삼고,
 * TTL 은 무효화를 놓쳤을 때의 안전망으로만 쓴다.
 */
export function invalidatePolicyCache(): void {
  cache = null;
}
