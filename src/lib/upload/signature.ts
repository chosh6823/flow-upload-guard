/**
 * 파일 시그니처(매직넘버) 판별.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  왜 필요한가
 *
 *  확장자 차단은 "파일명"을 믿는 방어다. 그런데 파일명은 공격자가 정한다.
 *  `virus.exe` 를 `photo.png` 로 rename 하면 확장자 정책은 100% 통과한다.
 *  Content-Type 헤더도 마찬가지다 — 그건 클라이언트가 보낸 문자열이지
 *  파일에 대한 사실이 아니다.
 *
 *  파일의 첫 바이트만이 클라이언트가 위조하기 어려운 유일한 신호다.
 *  (위조하면 그 파일은 더 이상 실행되지 않으므로, 공격 목적을 잃는다)
 *
 *  이 모듈은 "확장자만으로는 못 막는다"는 명제에 대한 실질적인 답이다.
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  한계 (CONSIDERATIONS.md §3-3 에서 다시 다룬다)
 *   - polyglot 파일: 유효한 GIF 이면서 동시에 유효한 스크립트인 파일은 통과한다.
 *   - zip 계열은 컨테이너다. docx/xlsx/jar/apk 가 모두 PK.. 로 시작하므로
 *     시그니처만으로는 "안에 exe 가 있는지" 알 수 없다. 압축 해제는 하지 않는다.
 *   - 매크로가 든 문서(docm/xlsm)는 시그니처로 구분되지 않는다.
 */

/** 판별된 파일 종류. 'unknown' 은 "우리가 아는 시그니처가 아님"일 뿐 안전하다는 뜻이 아니다. */
export type SniffedType =
  | 'executable-pe' // Windows PE (.exe .dll .scr .cpl ...)
  | 'executable-elf' // Linux/Unix ELF
  | 'executable-macho' // macOS Mach-O
  | 'java-class' // JVM class
  | 'script-shebang' // #! 로 시작하는 스크립트
  | 'archive-zip' // zip / docx / xlsx / jar / apk
  | 'archive-rar'
  | 'archive-7z'
  | 'archive-gzip'
  | 'image-png'
  | 'image-jpeg'
  | 'image-gif'
  | 'image-bmp'
  | 'document-pdf'
  | 'unknown';

interface SignatureRule {
  type: SniffedType;
  /** 파일 선두에서 비교할 바이트 시퀀스 */
  magic: number[];
  /** 시퀀스 시작 오프셋 (기본 0) */
  offset?: number;
  /** 이 종류가 "실행 가능한 것"으로 간주되는가 */
  executable: boolean;
}

/**
 * 시그니처 테이블.
 *
 * 순서가 의미를 갖는다 — 더 길고 구체적인 시그니처를 먼저 둔다.
 * (Mach-O 4바이트가 임의의 2바이트 시그니처보다 앞서야 오탐이 없다)
 */
const SIGNATURES: SignatureRule[] = [
  // ---- 실행 파일 ---------------------------------------------------------
  // ELF: 0x7F 'E' 'L' 'F'
  { type: 'executable-elf', magic: [0x7f, 0x45, 0x4c, 0x46], executable: true },

  // Mach-O (32/64bit, little/big endian) + universal binary
  { type: 'executable-macho', magic: [0xfe, 0xed, 0xfa, 0xce], executable: true },
  { type: 'executable-macho', magic: [0xfe, 0xed, 0xfa, 0xcf], executable: true },
  { type: 'executable-macho', magic: [0xce, 0xfa, 0xed, 0xfe], executable: true },
  { type: 'executable-macho', magic: [0xcf, 0xfa, 0xed, 0xfe], executable: true },

  // Java class / Mach-O fat binary 공용 매직 0xCAFEBABE
  { type: 'java-class', magic: [0xca, 0xfe, 0xba, 0xbe], executable: true },

  // Windows PE: 'M' 'Z' — DOS MZ 헤더.
  // .exe 뿐 아니라 .dll .scr .cpl .sys 가 전부 여기 해당한다.
  // 2바이트라 오탐 여지가 있지만, 정상 파일이 MZ 로 시작하는 경우는 사실상 없다.
  { type: 'executable-pe', magic: [0x4d, 0x5a], executable: true },

  // 스크립트 shebang: '#' '!'
  // 확장자가 .txt 여도 이건 실행 의도가 있는 파일이다.
  { type: 'script-shebang', magic: [0x23, 0x21], executable: true },

  // ---- 아카이브 (실행은 아니지만 안을 알 수 없음) --------------------------
  { type: 'archive-zip', magic: [0x50, 0x4b, 0x03, 0x04], executable: false },
  { type: 'archive-zip', magic: [0x50, 0x4b, 0x05, 0x06], executable: false }, // 빈 zip
  { type: 'archive-rar', magic: [0x52, 0x61, 0x72, 0x21], executable: false },
  { type: 'archive-7z', magic: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], executable: false },
  { type: 'archive-gzip', magic: [0x1f, 0x8b], executable: false },

  // ---- 일반 파일 ---------------------------------------------------------
  { type: 'document-pdf', magic: [0x25, 0x50, 0x44, 0x46], executable: false },
  { type: 'image-png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], executable: false },
  { type: 'image-jpeg', magic: [0xff, 0xd8, 0xff], executable: false },
  { type: 'image-gif', magic: [0x47, 0x49, 0x46, 0x38], executable: false },
  { type: 'image-bmp', magic: [0x42, 0x4d], executable: false },
];

/** 시그니처 판별에 필요한 최소 바이트 수. 파일 전체를 읽을 필요가 없다. */
export const SIGNATURE_PROBE_BYTES = 16;

export interface SniffResult {
  type: SniffedType;
  /** 실행 파일/스크립트로 판별되었는가 */
  executable: boolean;
}

/**
 * 파일 선두 바이트로 종류를 판별한다.
 *
 * @param head 파일의 앞부분 (최소 SIGNATURE_PROBE_BYTES 바이트면 충분)
 */
export function sniffSignature(head: Uint8Array): SniffResult {
  for (const rule of SIGNATURES) {
    const offset = rule.offset ?? 0;
    if (head.length < offset + rule.magic.length) continue;

    let matched = true;
    for (let i = 0; i < rule.magic.length; i += 1) {
      if (head[offset + i] !== rule.magic[i]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return { type: rule.type, executable: rule.executable };
    }
  }

  return { type: 'unknown', executable: false };
}

/** 사람이 읽는 종류 이름. 차단 사유 메시지에 쓴다. */
export function describeSniffedType(type: SniffedType): string {
  const labels: Record<SniffedType, string> = {
    'executable-pe': 'Windows 실행 파일(PE)',
    'executable-elf': 'Linux 실행 파일(ELF)',
    'executable-macho': 'macOS 실행 파일(Mach-O)',
    'java-class': 'Java 클래스 파일',
    'script-shebang': '실행 스크립트(shebang)',
    'archive-zip': 'ZIP 계열 압축 파일',
    'archive-rar': 'RAR 압축 파일',
    'archive-7z': '7z 압축 파일',
    'archive-gzip': 'gzip 압축 파일',
    'image-png': 'PNG 이미지',
    'image-jpeg': 'JPEG 이미지',
    'image-gif': 'GIF 이미지',
    'image-bmp': 'BMP 이미지',
    'document-pdf': 'PDF 문서',
    unknown: '알 수 없는 형식',
  };
  return labels[type];
}
