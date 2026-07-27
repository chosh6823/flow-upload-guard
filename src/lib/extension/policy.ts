/**
 * 차단 정책 읽기 경로.
 *
 * 업로드마다 DB 를 왕복할 이유는 없다. 정책은 자주 읽히고 드물게 바뀌는 데이터다.
 * 캐시 상태 자체는 policy-cache.ts 가 들고 있다(순환 참조 회피).
 *
 * 서버리스 주의: 함수 인스턴스마다 캐시가 따로 존재하므로,
 * 한 인스턴스에서 무효화해도 다른 인스턴스는 모른다. TTL 이 그래서 필요하다.
 * 공유 캐시(Redis)는 이 규모(최대 207행)에 과하다 — CONSIDERATIONS.md §5-2.
 */

import { POLICY_CACHE_TTL_MS } from '../config';
import { listBlockedExtensions } from './repository';
import { readPolicyCache, writePolicyCache } from './policy-cache';

export { invalidatePolicyCache } from './policy-cache';

/** 지금 차단 중인 확장자 집합. */
export async function getBlockedExtensionSet(): Promise<Set<string>> {
  const cached = readPolicyCache(POLICY_CACHE_TTL_MS);
  if (cached) return cached;

  const blocked = new Set(await listBlockedExtensions());
  writePolicyCache(blocked);
  return blocked;
}
