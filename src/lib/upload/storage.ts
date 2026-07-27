/**
 * 업로드 파일 저장.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  저장 규칙 세 가지 — 확장자 검증이 뚫려도 피해가 나지 않게 하는 층이다.
 *
 *  1. 파일명은 서버가 정한다 (UUID).
 *     사용자가 준 이름으로 경로를 만드는 순간 `../../etc/cron.d/x` 가 가능해진다.
 *     원본 이름은 DB 컬럼(original_name)에 문자열로만 보관한다.
 *
 *  2. 확장자를 붙이지 않는다.
 *     디스크에 `abc123` 으로만 저장한다. 파일명에 실행 확장자가 없으면
 *     웹서버가 실수로 핸들러를 물릴 여지 자체가 없다.
 *
 *  3. 웹 루트(public/) 바깥에 저장한다.
 *     public/ 에 두면 Next.js 가 그대로 정적 서빙한다. 업로드한 HTML 이
 *     같은 오리진에서 실행되면 저장형 XSS 다.
 *
 *  + 권한 0600. 실행 비트를 애초에 주지 않는다.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { STORAGE_DRIVER, STORAGE_DIR } from '../config';

export interface StoredFile {
  /** 디스크에 저장된 이름. 'none' 드라이버에서는 'discarded'. */
  storedName: string;
  persisted: boolean;
}

/**
 * 검증을 통과한 파일을 저장한다.
 *
 * STORAGE_DRIVER='none' 일 때는 본문을 버린다.
 * Vercel 같은 서버리스에서 로컬 디스크에 쓰면 다음 요청에서 사라지는데,
 * "저장된 것처럼 보이지만 실제로는 없는" 상태가 가장 나쁘다.
 * 조용히 실패하느니 명시적으로 버리고, 그 사실을 응답에 표시한다.
 */
export async function storeFile(bytes: Uint8Array): Promise<StoredFile> {
  const storedName = randomUUID();

  if (STORAGE_DRIVER === 'none') {
    return { storedName: 'discarded', persisted: false };
  }

  const dir = path.resolve(STORAGE_DIR);
  await mkdir(dir, { recursive: true });

  // path.join 이 아니라 resolve 후 접두사 확인까지 하는 이유는
  // storedName 이 UUID 라 사실상 불필요하지만, 저장명 생성 방식이
  // 나중에 바뀌더라도 경로 탈출이 생기지 않게 하기 위한 방어다.
  const target = path.resolve(dir, storedName);
  if (!target.startsWith(dir + path.sep)) {
    throw new Error('저장 경로가 스토리지 디렉터리를 벗어났습니다.');
  }

  // mode 0o600: 소유자 읽기/쓰기만. 실행 비트 없음.
  await writeFile(target, bytes, { mode: 0o600 });

  return { storedName, persisted: true };
}
