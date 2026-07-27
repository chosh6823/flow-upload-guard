/**
 * 애플리케이션 전역 정책 상수.
 *
 * "매직 넘버를 코드 곳곳에 흩뿌리지 않는다"는 목적도 있지만,
 * 더 중요한 이유는 **정책 값이 곧 과제 명세**이기 때문이다.
 * 명세가 바뀌면 이 파일 한 곳만 보면 된다.
 */

/** 명세상 고정 확장자 7종. 순서는 화면 표시 순서와 같다. */
export const FIXED_EXTENSIONS = [
  'bat',
  'cmd',
  'com',
  'cpl',
  'exe',
  'scr',
  'js',
] as const;

/** 커스텀 확장자 입력 최대 길이 (명세). DB CHECK 제약과 동일한 값이어야 한다. */
export const MAX_EXTENSION_LENGTH = 20;

/** 커스텀 확장자 최대 개수 (명세). */
export const MAX_CUSTOM_EXTENSIONS = 200;

/** 파일명 최대 길이. upload_record.original_name VARCHAR(255) 와 동일. */
export const MAX_FILENAME_LENGTH = 255;

/**
 * 업로드 파일 최대 크기.
 * 무제한이면 스토리지 고갈/메모리 고갈로 가는 가장 싼 DoS 경로가 열린다.
 * Vercel Serverless Function 의 요청 본문 상한(4.5MB)보다 작게 잡아,
 * 플랫폼이 먼저 끊어서 원인 불명 에러가 나는 상황을 피한다.
 */
export const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024; // 4MB

/**
 * 확장자 스캔 모드.
 *
 *  'all'  : 파일명의 모든 점 구간을 검사한다. `resume.exe.pdf` 도 차단.
 *  'last' : 마지막 확장자만 검사한다. `resume.exe.pdf` 는 통과.
 *
 * 기본값을 'all' 로 둔 이유:
 *   - Apache mod_mime 계열은 중간 확장자도 핸들러로 해석해 왔다 (shell.php.jpg 실행 사고).
 *   - `견적서.exe.pdf` 는 아이콘/확장자 숨김 환경에서 가장 흔한 사회공학 파일명이다.
 * 대가:
 *   - `jquery.min.js` 처럼 정상 파일도 중간 구간 때문에 걸릴 수 있다(과차단).
 *   보안 컨트롤에서는 과차단이 미차단보다 안전한 실패 방향이라고 판단했다.
 *   자세한 논의는 CONSIDERATIONS.md §3-2.
 */
export const EXTENSION_SCAN_MODE: 'all' | 'last' =
  process.env.EXTENSION_SCAN_MODE === 'last' ? 'last' : 'all';

/**
 * 매직넘버(파일 시그니처) 검사로 실행 파일을 차단할지 여부.
 *
 * 확장자 차단만으로는 `virus.exe` 를 `photo.png` 로 이름만 바꾼 파일을 절대 막지 못한다.
 * 이 옵션이 그 구멍을 메운다. 기본 활성.
 */
export const BLOCK_EXECUTABLE_SIGNATURE =
  process.env.BLOCK_EXECUTABLE_SIGNATURE !== 'false';

/**
 * 저장 드라이버.
 *
 *  'local' : 웹 루트 밖 디렉터리에 UUID 파일명으로 저장 (로컬 개발 / 자체 호스팅)
 *  'none'  : 검증만 하고 본문은 버린다 (Vercel 등 파일시스템이 휘발되는 서버리스 데모)
 *
 * 서버리스에서 로컬 디스크에 쓰면 다음 요청에서 사라진다.
 * "저장된 것처럼 보이지만 실제로는 없는" 상태가 가장 나쁘므로, 명시적으로 버린다.
 */
export const STORAGE_DRIVER: 'local' | 'none' =
  process.env.STORAGE_DRIVER === 'local' ? 'local' : 'none';

/** 'local' 드라이버가 쓸 저장 경로. 반드시 public/ 바깥이어야 한다. */
export const STORAGE_DIR = process.env.STORAGE_DIR ?? './storage';

/**
 * 정책 캐시 TTL(ms).
 * 업로드마다 DB 를 왕복할 필요는 없지만, 정책을 껐는데 계속 막히면 안 되므로
 * 짧게 잡고 정책 변경 시에는 명시적으로 무효화한다. (src/lib/extension/policy.ts)
 */
export const POLICY_CACHE_TTL_MS = 5_000;
