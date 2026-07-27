/**
 * 업로드 검증 오케스트레이션.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  이 함수가 **유일한 강제 지점**이다.
 *
 *  화면의 `accept` 속성도, 클라이언트 JS 검증도 전부 UX 를 위한 장식이다.
 *  개발자도구로 지우거나 curl 로 직접 쏘면 그만이다.
 *  정책이 실제로 강제되는 곳은 서버의 이 함수 하나뿐이고,
 *  라우트 핸들러는 이 함수를 거치지 않고 파일을 저장할 방법이 없어야 한다.
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  검사 순서에도 이유가 있다 — 싸고 확실한 것부터, 비싼 것은 나중에.
 *   1. 파일명 자체가 비정상인가        (문자열 검사, 가장 싸다)
 *   2. 크기가 상한을 넘는가            (메모리에 올리기 전에 끊는다)
 *   3. 확장자가 차단 목록에 있는가      (정책 조회, 캐시됨)
 *   4. 실제 내용이 실행 파일인가        (바이트 판독, 가장 비싸다)
 */

import {
  MAX_FILE_SIZE_BYTES,
  BLOCK_EXECUTABLE_SIGNATURE,
} from '../config';
import { inspectFilename } from '../extension/normalize';
import { getBlockedExtensionSet } from '../extension/policy';
import {
  sniffSignature,
  describeSniffedType,
  SIGNATURE_PROBE_BYTES,
  type SniffedType,
} from './signature';

export type RejectReason =
  // 파일명 단계
  | 'EMPTY_FILENAME'
  | 'FILENAME_TOO_LONG'
  | 'ILLEGAL_CONTROL_CHAR'
  | 'ILLEGAL_BIDI_CHAR'
  | 'ILLEGAL_PATH_SEPARATOR'
  // 크기 단계
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  // 정책 단계
  | 'BLOCKED_EXTENSION'
  // 내용 단계
  | 'EXECUTABLE_SIGNATURE';

export interface ValidationAccepted {
  ok: true;
  filename: string;
  extensions: string[];
  sniffedType: SniffedType;
  sizeBytes: number;
}

export interface ValidationRejected {
  ok: false;
  reason: RejectReason;
  /** 사용자에게 보여줄 메시지. "왜 막혔는지"가 반드시 들어간다. */
  message: string;
  /** 차단을 유발한 확장자 (해당되는 경우) */
  matchedExtension?: string;
  sniffedType?: SniffedType;
  sizeBytes: number;
}

export type ValidationResult = ValidationAccepted | ValidationRejected;

export interface UploadCandidate {
  filename: unknown;
  sizeBytes: number;
  /** 시그니처 판독용 선두 바이트. 최소 SIGNATURE_PROBE_BYTES 바이트. */
  head: Uint8Array;
}

/**
 * 업로드를 허용할지 판정한다.
 *
 * 순수하지는 않다(정책 조회를 위해 DB/캐시를 읽는다). 하지만 파일 저장이나
 * 로그 기록 같은 부수효과는 전혀 없다 — 판정만 한다.
 * 그래서 "정책이 A일 때 이 파일명이 어떻게 되는가"를 테스트로 고정하기 쉽다.
 */
export async function validateUpload(
  candidate: UploadCandidate
): Promise<ValidationResult> {
  const { sizeBytes } = candidate;

  // ── 1. 파일명 ────────────────────────────────────────────────────────────
  const named = inspectFilename(candidate.filename);
  if (!named.ok) {
    return {
      ok: false,
      reason: named.code,
      message: named.message,
      sizeBytes,
    };
  }

  // ── 2. 크기 ──────────────────────────────────────────────────────────────
  if (sizeBytes <= 0) {
    return {
      ok: false,
      reason: 'EMPTY_FILE',
      message: '빈 파일은 업로드할 수 없습니다.',
      sizeBytes,
    };
  }

  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      reason: 'FILE_TOO_LARGE',
      message: `파일 크기가 상한(${formatBytes(MAX_FILE_SIZE_BYTES)})을 초과했습니다.`,
      sizeBytes,
    };
  }

  // ── 3. 확장자 정책 ───────────────────────────────────────────────────────
  const blocked = await getBlockedExtensionSet();
  const matched = named.extensions.find((ext) => blocked.has(ext));

  if (matched) {
    return {
      ok: false,
      reason: 'BLOCKED_EXTENSION',
      // 어떤 확장자 때문에 막혔는지 밝힌다.
      // 정책 전체를 노출하는 것과 개별 사유를 알리는 것은 다르다 —
      // 사유를 숨기면 사용자는 고칠 수가 없다. (CONSIDERATIONS.md §3-5)
      message: `'.${matched}' 확장자는 차단 정책에 의해 업로드할 수 없습니다.`,
      matchedExtension: matched,
      sizeBytes,
    };
  }

  // ── 4. 내용(매직넘버) ────────────────────────────────────────────────────
  const sniff = sniffSignature(candidate.head.subarray(0, SIGNATURE_PROBE_BYTES));

  if (BLOCK_EXECUTABLE_SIGNATURE && sniff.executable) {
    return {
      ok: false,
      reason: 'EXECUTABLE_SIGNATURE',
      // 확장자를 위장한 케이스다. 이 메시지가 나온다는 것 자체가
      // "이름만 바꿔서는 통과 못 한다"는 증거다.
      message: `파일 내용이 ${describeSniffedType(
        sniff.type
      )}(으)로 판별되었습니다. 확장자와 무관하게 실행 파일은 업로드할 수 없습니다.`,
      sniffedType: sniff.type,
      sizeBytes,
    };
  }

  return {
    ok: true,
    filename: named.cleaned,
    extensions: named.extensions,
    sniffedType: sniff.type,
    sizeBytes,
  };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}
