/**
 * 확장자 정책 데이터 접근 계층.
 *
 * SQL 을 여기 한 곳에 모아 둔다. 라우트 핸들러는 SQL 을 모른다.
 * 모든 쿼리는 파라미터 바인딩($1, $2)만 쓴다 — 문자열 연결은 한 군데도 없다.
 */

import { pool, withTransaction, isUniqueViolation } from '../db';
import { MAX_CUSTOM_EXTENSIONS } from '../config';
import { invalidatePolicyCache } from './policy-cache';

export type ExtensionType = 'FIXED' | 'CUSTOM';

export interface BlockedExtensionRow {
  id: string;
  extension: string;
  type: ExtensionType;
  isBlocked: boolean;
  createdAt: string;
}

export type AddCustomResult =
  | { ok: true; row: BlockedExtensionRow }
  | { ok: false; code: 'DUPLICATE' | 'LIMIT_EXCEEDED'; message: string };

/**
 * 커스텀 확장자 추가 시 잡는 advisory lock 의 키.
 * 임의의 상수면 되지만, 다른 기능이 같은 키를 쓰지 않도록 한 곳에 정의해 둔다.
 */
const CUSTOM_EXTENSION_LOCK_KEY = 851_042;

// ---------------------------------------------------------------------------
// 조회
// ---------------------------------------------------------------------------

/** 전체 정책 조회. 고정 → 커스텀(추가 순) 정렬. */
export async function listExtensions(): Promise<BlockedExtensionRow[]> {
  const { rows } = await pool.query<{
    id: string;
    extension: string;
    type: ExtensionType;
    is_blocked: boolean;
    created_at: Date;
  }>(
    `SELECT id, extension, type, is_blocked, created_at
       FROM blocked_extension
      ORDER BY CASE type WHEN 'FIXED' THEN 0 ELSE 1 END, created_at, id`
  );

  return rows.map(toRow);
}

/**
 * 지금 차단 중인 확장자 집합.
 * 업로드 검증이 매번 호출하는 경로이므로 필요한 컬럼만 가져온다.
 * (부분 인덱스 ix_blocked_extension_active 가 이 쿼리를 위해 존재한다)
 */
export async function listBlockedExtensions(): Promise<string[]> {
  const { rows } = await pool.query<{ extension: string }>(
    `SELECT extension FROM blocked_extension WHERE is_blocked = TRUE`
  );
  return rows.map((r) => r.extension);
}

export async function countCustomExtensions(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM blocked_extension WHERE type = 'CUSTOM'`
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * 지금 차단 중인 확장자의 **개수**.
 *
 * 업로드 화면은 이 숫자만 보여주고 목록은 보여주지 않는다.
 * "지금 정책이 켜져 있는지"는 업로드하는 사람이 알아야 하지만,
 * 차단 목록 전체는 정책 관리 권한을 가진 사람이 볼 것이기 때문이다.
 * (근거: CONSIDERATIONS.md §2-4)
 */
export async function countBlockedExtensions(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM blocked_extension WHERE is_blocked = TRUE`
  );
  return Number(rows[0]?.count ?? 0);
}

// ---------------------------------------------------------------------------
// 변경
// ---------------------------------------------------------------------------

/**
 * 커스텀 확장자 추가.
 *
 * 두 가지 경합을 동시에 막아야 한다.
 *
 *  1) 중복 추가
 *     "SELECT 로 없는 걸 확인하고 INSERT" 는 두 요청이 동시에 오면 뚫린다.
 *     → UNIQUE 제약을 최종 방어선으로 삼고, 위반(23505)을 잡아 DUPLICATE 로 변환한다.
 *
 *  2) 200개 초과
 *     COUNT 는 "존재하지 않는 행"을 잠글 수 없으므로 SELECT ... FOR UPDATE 로는
 *     막을 수 없다(팬텀 리드). 199개 상태에서 두 요청이 동시에 들어오면 201개가 된다.
 *     → 트랜잭션 범위 advisory lock 으로 추가 연산 자체를 직렬화한다.
 *       테이블 전체를 LOCK 하는 것보다 가볍고, 읽기(업로드 검증)를 막지 않는다.
 *
 * 참고: extension 은 호출 전에 normalizeExtension() 을 통과한 값이어야 한다.
 *       (형식은 DB 의 ck_blocked_extension_format 가 한 번 더 검증한다)
 */
export async function addCustomExtension(
  extension: string
): Promise<AddCustomResult> {
  try {
    const row = await withTransaction(async (client) => {
      // 이 트랜잭션이 끝날 때 자동 해제되는 락. 커스텀 추가만 직렬화한다.
      await client.query('SELECT pg_advisory_xact_lock($1)', [
        CUSTOM_EXTENSION_LOCK_KEY,
      ]);

      const { rows: countRows } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM blocked_extension
          WHERE type = 'CUSTOM'`
      );

      if (Number(countRows[0].count) >= MAX_CUSTOM_EXTENSIONS) {
        // 트랜잭션 안에서 던져 롤백시킨 뒤, 바깥에서 코드로 변환한다.
        throw new LimitExceededError();
      }

      const { rows } = await client.query<{
        id: string;
        extension: string;
        type: ExtensionType;
        is_blocked: boolean;
        created_at: Date;
      }>(
        `INSERT INTO blocked_extension (extension, type, is_blocked)
              VALUES ($1, 'CUSTOM', TRUE)
           RETURNING id, extension, type, is_blocked, created_at`,
        [extension]
      );

      await client.query(
        `INSERT INTO extension_policy_audit (extension, action) VALUES ($1, 'ADD')`,
        [extension]
      );

      return toRow(rows[0]);
    });

    invalidatePolicyCache();
    return { ok: true, row };
  } catch (error) {
    if (error instanceof LimitExceededError) {
      return {
        ok: false,
        code: 'LIMIT_EXCEEDED',
        message: `커스텀 확장자는 최대 ${MAX_CUSTOM_EXTENSIONS}개까지 추가할 수 있습니다.`,
      };
    }

    if (isUniqueViolation(error)) {
      // 고정 확장자와 겹치는 경우도 여기로 온다. 메시지를 나누고 싶다면
      // 여기서 type 을 다시 조회하면 되지만, 사용자 입장에서는 "이미 있다"로 충분하다.
      return {
        ok: false,
        code: 'DUPLICATE',
        message: `'${extension}' 은(는) 이미 등록된 확장자입니다.`,
      };
    }

    throw error;
  }
}

/** 커스텀 확장자 삭제. 고정 확장자는 이 경로로 삭제되지 않는다. */
export async function removeCustomExtension(id: string): Promise<boolean> {
  const removed = await withTransaction(async (client) => {
    // type = 'CUSTOM' 조건을 WHERE 에 둬서, id 를 조작해도 고정 확장자는 지워지지 않게 한다.
    const { rows } = await client.query<{ extension: string }>(
      `DELETE FROM blocked_extension
             WHERE id = $1 AND type = 'CUSTOM'
         RETURNING extension`,
      [id]
    );

    if (rows.length === 0) return null;

    await client.query(
      `INSERT INTO extension_policy_audit (extension, action) VALUES ($1, 'REMOVE')`,
      [rows[0].extension]
    );

    return rows[0].extension;
  });

  if (removed) invalidatePolicyCache();
  return removed !== null;
}

/** 고정 확장자 체크/언체크. 커스텀은 이 경로로 바뀌지 않는다. */
export async function setFixedExtensionBlocked(
  id: string,
  isBlocked: boolean
): Promise<BlockedExtensionRow | null> {
  const row = await withTransaction(async (client) => {
    const { rows } = await client.query<{
      id: string;
      extension: string;
      type: ExtensionType;
      is_blocked: boolean;
      created_at: Date;
    }>(
      `UPDATE blocked_extension
          SET is_blocked = $2, updated_at = now()
        WHERE id = $1 AND type = 'FIXED'
    RETURNING id, extension, type, is_blocked, created_at`,
      [id, isBlocked]
    );

    if (rows.length === 0) return null;

    await client.query(
      `INSERT INTO extension_policy_audit (extension, action) VALUES ($1, $2)`,
      [rows[0].extension, isBlocked ? 'BLOCK' : 'UNBLOCK']
    );

    return toRow(rows[0]);
  });

  if (row) invalidatePolicyCache();
  return row;
}

// ---------------------------------------------------------------------------
// 내부
// ---------------------------------------------------------------------------

class LimitExceededError extends Error {
  constructor() {
    super('CUSTOM_EXTENSION_LIMIT_EXCEEDED');
    this.name = 'LimitExceededError';
  }
}

function toRow(r: {
  id: string;
  extension: string;
  type: ExtensionType;
  is_blocked: boolean;
  created_at: Date;
}): BlockedExtensionRow {
  return {
    id: String(r.id),
    extension: r.extension,
    type: r.type,
    isBlocked: r.is_blocked,
    createdAt: new Date(r.created_at).toISOString(),
  };
}
