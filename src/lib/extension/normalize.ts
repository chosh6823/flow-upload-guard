/**
 * 확장자 · 파일명 정규화.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  이 파일이 이 과제의 심장이다.
 *
 *  "sh 를 추가한 뒤 다시 sh 를 추가하면?" 이라는 명세의 질문은
 *  사실 "무엇을 같은 확장자로 볼 것인가"를 정의하라는 요구다.
 *  정규화 규칙을 먼저 못 박지 않으면 중복 판정도, 차단 판정도 성립하지 않는다.
 *
 *  따라서 아래 두 함수를 **유일한 출처**로 삼는다.
 *    - normalizeExtension() : 정책에 저장할 확장자를 정규화한다.
 *    - extractExtensions()  : 업로드 파일명에서 검사 대상 확장자를 뽑는다.
 *  둘은 반드시 같은 정규화 규칙(NFKC → 소문자 → 트림)을 공유해야 한다.
 *  한쪽만 소문자로 바꾸면 ".EXE" 가 통과한다.
 *
 *  모든 함수는 순수 함수다. DB 도 I/O 도 없으므로 단위 테스트가 전부 커버한다.
 *
 *  주의: 이 파일의 정규식은 모두 \u 이스케이프로 작성한다.
 *        제어문자를 소스에 직접 넣으면 에디터/디프에서 보이지 않아
 *        "왜 이게 안 걸리지"를 추적할 수 없게 된다.
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  MAX_EXTENSION_LENGTH,
  MAX_FILENAME_LENGTH,
  EXTENSION_SCAN_MODE,
} from '../config';

// ---------------------------------------------------------------------------
// 결과 타입
// ---------------------------------------------------------------------------

export type ExtensionRejectCode = 'EMPTY' | 'TOO_LONG' | 'INVALID_CHARS';

export type NormalizeExtensionResult =
  | { ok: true; value: string }
  | { ok: false; code: ExtensionRejectCode; message: string };

export type FilenameRejectCode =
  | 'EMPTY_FILENAME'
  | 'FILENAME_TOO_LONG'
  | 'ILLEGAL_CONTROL_CHAR'
  | 'ILLEGAL_BIDI_CHAR'
  | 'ILLEGAL_PATH_SEPARATOR';

export type InspectFilenameResult =
  | { ok: true; cleaned: string; extensions: string[] }
  | { ok: false; code: FilenameRejectCode; message: string };

// ---------------------------------------------------------------------------
// 위험 문자 패턴
// ---------------------------------------------------------------------------

/**
 * 제어문자 (널바이트 U+0000 포함).
 *
 * "a.exe\u0000.png" 은 C 문자열 기반 레거시 계층에서 "a.exe" 로 잘린다.
 * Node 런타임 안에서는 무해하지만, 이 파일명이 그대로 외부 스토리지·
 * 안티바이러스·레거시 시스템으로 넘어가는 순간 위험해진다.
 * 정상적인 파일명에 제어문자가 들어갈 이유가 전혀 없으므로 무조건 거부한다.
 */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/**
 * 유니코드 양방향 제어문자(BiDi) · 제로폭 문자.
 *
 * 대표적으로 U+202E(RTLO)를 파일명에 넣으면
 *   실제 바이트: "photo_" + U+202E + "gnp.exe"
 *   화면 표시  : "photo_exe.png"
 * 로 보인다. 사람 눈에는 png, OS 에는 exe 다.
 *
 * 확장자 추출만 놓고 보면 이 파일은 어차피 exe 로 잡히지만,
 * **사용자를 속이려는 의도 자체가 명백**하므로 파일명 단계에서 따로 끊는다.
 * (차단 사유가 "exe 라서"가 아니라 "파일명 위장"이어야 로그가 의미를 갖는다)
 *
 *   U+200B~U+200F : 제로폭 공백 / LRM / RLM
 *   U+202A~U+202E : LRE RLE PDF LRO RLO
 *   U+2060~U+2064 : word joiner 등
 *   U+2066~U+2069 : isolate 계열
 *   U+FEFF        : BOM / zero-width no-break space
 */
const BIDI_OR_ZEROWIDTH =
  /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/;

/** 경로 구분자. 파일명에 디렉터리가 섞여 들어오는 경우. */
const PATH_SEPARATOR = /[/\\]/;

/** 정규화 후 확장자가 만족해야 하는 형태. DB 의 ck_blocked_extension_format 와 동일. */
const VALID_EXTENSION = /^[a-z0-9]{1,20}$/;

/**
 * 후행 점 · 공백.
 * Windows 는 "a.exe." 와 "a.exe " 를 파일시스템에 만들 때 뒤쪽을 잘라내
 * 결국 "a.exe" 가 된다. 검사 전에 우리도 똑같이 잘라야 우회가 막힌다.
 * (\u00A0 은 비단절 공백 — 눈에 안 보이는 공백으로 넘어오는 경우)
 */
const TRAILING_DOTS_AND_SPACES = /[.\s\u00A0]+$/;

/** 앞뒤 공백 트림용 (일반 공백 + 비단절 공백) */
const OUTER_WHITESPACE = /^[\s\u00A0]+|[\s\u00A0]+$/g;

// ---------------------------------------------------------------------------
// 확장자 정규화 (정책 입력용)
// ---------------------------------------------------------------------------

/**
 * 사용자가 입력한 커스텀 확장자 문자열을 정책에 저장할 표준형으로 바꾼다.
 *
 * 규칙 (순서가 중요하다):
 *   1. NFKC 정규화   — 전각 "ｅｘｅ" 를 반각 "exe" 로 접는다. 동형문자 우회 방지.
 *   2. 앞뒤 공백 제거 — " sh " → "sh"
 *   3. 선행 '.' 제거  — ".sh" → "sh". 사용자는 점을 붙여 쓰는 습관이 있다.
 *   4. 소문자 변환    — "SH" → "sh". 대소문자는 같은 확장자다.
 *   5. 형식 검증      — ^[a-z0-9]{1,20}$
 *
 * 1~4를 거친 뒤 비교하기 때문에
 *   sh / SH / .sh / " sh " / 전각 ｓｈ
 * 는 전부 같은 확장자로 판정되어 중복 추가가 막힌다.
 */
export function normalizeExtension(raw: unknown): NormalizeExtensionResult {
  if (typeof raw !== 'string') {
    return { ok: false, code: 'EMPTY', message: '확장자를 입력해 주세요.' };
  }

  // 1) 유니코드 호환 정규화
  let value = raw.normalize('NFKC');

  // 2) 앞뒤 공백(비단절 공백 포함) 제거
  value = value.replace(OUTER_WHITESPACE, '');

  // 3) 선행 점 제거 (".sh", "..sh" → "sh")
  value = value.replace(/^\.+/, '');

  // 4) 소문자
  value = value.toLowerCase();

  if (value.length === 0) {
    return { ok: false, code: 'EMPTY', message: '확장자를 입력해 주세요.' };
  }

  // 길이 초과와 문자 오류를 구분해서 알려준다.
  // "입력이 잘못됐다"보다 "20자를 넘었다"가 사용자가 고칠 수 있는 메시지다.
  if (value.length > MAX_EXTENSION_LENGTH) {
    return {
      ok: false,
      code: 'TOO_LONG',
      message: `확장자는 최대 ${MAX_EXTENSION_LENGTH}자까지 입력할 수 있습니다.`,
    };
  }

  if (!VALID_EXTENSION.test(value)) {
    return {
      ok: false,
      code: 'INVALID_CHARS',
      message: '확장자는 영문 소문자와 숫자만 사용할 수 있습니다.',
    };
  }

  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// 파일명 검사 (업로드용)
// ---------------------------------------------------------------------------

/**
 * 업로드된 파일명을 검사하고, 차단 판정에 쓸 확장자 목록을 뽑는다.
 *
 * 여기서 거부하는 것은 "확장자가 나빠서"가 아니라
 * **파일명 자체가 정상적인 경로로는 만들어질 수 없어서**다.
 * 즉 명백한 우회 시도이므로, 확장자 정책과 무관하게 먼저 끊는다.
 */
export function inspectFilename(rawName: unknown): InspectFilenameResult {
  if (typeof rawName !== 'string' || rawName.length === 0) {
    return {
      ok: false,
      code: 'EMPTY_FILENAME',
      message: '파일명이 비어 있습니다.',
    };
  }

  if (rawName.length > MAX_FILENAME_LENGTH) {
    return {
      ok: false,
      code: 'FILENAME_TOO_LONG',
      message: `파일명은 ${MAX_FILENAME_LENGTH}자를 넘을 수 없습니다.`,
    };
  }

  // 제어문자/널바이트 — 정규화 *전에* 원본에서 검사한다.
  // NFKC 가 일부 문자를 접어버리면 흔적이 사라질 수 있기 때문.
  if (CONTROL_CHARS.test(rawName)) {
    return {
      ok: false,
      code: 'ILLEGAL_CONTROL_CHAR',
      message: '파일명에 허용되지 않는 제어문자가 포함되어 있습니다.',
    };
  }

  if (BIDI_OR_ZEROWIDTH.test(rawName)) {
    return {
      ok: false,
      code: 'ILLEGAL_BIDI_CHAR',
      message: '파일명에 표시를 왜곡하는 유니코드 제어문자가 포함되어 있습니다.',
    };
  }

  // 브라우저는 보통 basename 만 보내지만, HTTP 요청은 직접 조립할 수 있다.
  // 우리는 어차피 원본 파일명으로 저장 경로를 만들지 않으므로 basename 만 취해도
  // 안전하지만, 명백한 이상 신호이므로 거부해서 로그에 남긴다.
  if (PATH_SEPARATOR.test(rawName)) {
    return {
      ok: false,
      code: 'ILLEGAL_PATH_SEPARATOR',
      message: '파일명에 경로 구분자를 포함할 수 없습니다.',
    };
  }

  const cleaned = rawName.normalize('NFKC');

  return { ok: true, cleaned, extensions: extractExtensions(cleaned) };
}

/**
 * 파일명에서 검사 대상 확장자들을 뽑는다.
 *
 * 처리 순서:
 *   1. 후행 점·공백 제거 — "a.exe." / "a.exe " → "a.exe" (Windows 가 그렇게 만든다)
 *   2. 선행 점 제거      — ".bashrc" 의 bashrc 는 확장자가 아니라 이름이다
 *   3. '.' 로 분리 후 **첫 구간(기본 이름)을 버리고** 나머지를 확장자 후보로 본다
 *   4. 각 구간을 NFKC → 트림 → 소문자
 *   5. 빈 구간("a..exe" 의 가운데) 제거, 중복 제거
 *
 * EXTENSION_SCAN_MODE 가 'last' 면 마지막 구간만 돌려준다.
 *
 * 예시:
 *   'report.pdf'     → ['pdf']
 *   'resume.exe.pdf' → ['exe', 'pdf']   ← 'all' 모드에서 exe 로 차단됨
 *   'a.EXE'          → ['exe']
 *   'a.exe.'         → ['exe']
 *   'a.exe   '       → ['exe']
 *   'a..exe'         → ['exe']
 *   '.bashrc'        → []               ← 확장자 없음
 *   'Dockerfile'     → []
 *   'archive.tar.gz' → ['tar', 'gz']
 */
export function extractExtensions(filename: string): string[] {
  // 1) 후행 점·공백 제거
  let name = filename.replace(TRAILING_DOTS_AND_SPACES, '');

  // 2) 선행 점 제거 (dotfile 의 이름 부분을 확장자로 오인하지 않기 위해)
  name = name.replace(/^\.+/, '');

  if (name.length === 0) return [];

  const segments = name.split('.');

  // 점이 없으면 확장자가 없다 ("Dockerfile", "README")
  if (segments.length < 2) return [];

  // 첫 구간은 기본 이름이므로 버린다
  const candidates = segments
    .slice(1)
    .map((segment) =>
      segment.normalize('NFKC').replace(OUTER_WHITESPACE, '').toLowerCase()
    )
    .filter((segment) => segment.length > 0);

  const scanned =
    EXTENSION_SCAN_MODE === 'last' ? candidates.slice(-1) : candidates;

  // 중복 제거 ("a.exe.exe" 가 두 번 보고되지 않도록)
  return [...new Set(scanned)];
}
