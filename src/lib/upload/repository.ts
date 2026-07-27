/**
 * 업로드 시도 기록.
 *
 * 성공한 업로드보다 **차단된 업로드**를 남기는 것이 이 테이블의 목적이다.
 * 정책이 실제로 작동하는지, 누가 우회를 시도하는지는 이 로그로만 알 수 있다.
 */

import { pool } from '../db';
import type { SniffedType } from './signature';
import type { RejectReason } from './validate';

export interface UploadRecordInput {
  originalName: string;
  storedName: string | null;
  sizeBytes: number;
  status: 'ACCEPTED' | 'REJECTED';
  rejectReason: RejectReason | null;
  matchedExtension: string | null;
  sniffedType: SniffedType | null;
}

export interface UploadRecordRow {
  id: string;
  originalName: string;
  storedName: string | null;
  sizeBytes: number;
  status: 'ACCEPTED' | 'REJECTED';
  rejectReason: string | null;
  matchedExtension: string | null;
  sniffedType: string | null;
  createdAt: string;
}

/**
 * 업로드 시도를 기록하고 id 를 돌려준다.
 *
 * 로깅 실패가 업로드 자체를 실패시키면 안 된다 —
 * 감사 로그는 부가 기능이고, 사용자 요청은 본 기능이다.
 * 다만 조용히 삼키면 "로그가 없다"는 사실조차 모르게 되므로 콘솔에는 남긴다.
 */
export async function recordUpload(
  input: UploadRecordInput
): Promise<string | null> {
  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO upload_record
         (original_name, stored_name, size_bytes, status,
          reject_reason, matched_extension, sniffed_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id`,
      [
        input.originalName,
        input.storedName,
        input.sizeBytes,
        input.status,
        input.rejectReason,
        input.matchedExtension,
        input.sniffedType,
      ]
    );
    return String(rows[0].id);
  } catch (error) {
    console.error('[upload_record] 기록 실패', error);
    return null;
  }
}

/** 최근 업로드 시도 목록. 화면 하단의 "최근 기록"에 쓴다. */
export async function listRecentUploads(limit = 15): Promise<UploadRecordRow[]> {
  const { rows } = await pool.query(
    `SELECT id, original_name, stored_name, size_bytes, status,
            reject_reason, matched_extension, sniffed_type, created_at
       FROM upload_record
      ORDER BY created_at DESC, id DESC
      LIMIT $1`,
    [Math.min(Math.max(limit, 1), 100)]
  );

  return rows.map((r) => ({
    id: String(r.id),
    originalName: r.original_name,
    storedName: r.stored_name,
    sizeBytes: Number(r.size_bytes),
    status: r.status,
    rejectReason: r.reject_reason,
    matchedExtension: r.matched_extension,
    sniffedType: r.sniffed_type,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}
