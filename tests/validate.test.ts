import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 정책 조회(DB)를 가로채서, "정책이 X일 때 이 파일이 어떻게 판정되는가"만 검증한다.
 * validateUpload 가 저장·로깅 같은 부수효과를 갖지 않게 설계했기 때문에
 * 이렇게 얇은 모킹만으로 전체 판정 경로를 커버할 수 있다.
 */
const blockedSet = new Set<string>();

vi.mock('@/lib/extension/policy', () => ({
  getBlockedExtensionSet: async () => blockedSet,
  invalidatePolicyCache: () => {},
}));

const { validateUpload } = await import('@/lib/upload/validate');
const { MAX_FILE_SIZE_BYTES } = await import('@/lib/config');

/** 평범한 텍스트 파일의 선두 바이트 (어떤 시그니처와도 안 겹침) */
const TEXT_HEAD = new TextEncoder().encode('hello world, 평범한 내용');
/** Windows PE 실행 파일의 선두 바이트 */
const PE_HEAD = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

function candidate(filename: string, head = TEXT_HEAD, size = head.byteLength) {
  return { filename, sizeBytes: size, head };
}

beforeEach(() => {
  blockedSet.clear();
});

// ---------------------------------------------------------------------------
describe('정책 강제', () => {
  it('차단 목록이 비어 있으면 exe 도 통과한다 (명세: 기본값 unCheck)', () => {
    // 이 동작이 명세 그대로다. 초기 상태에서는 아무것도 차단되지 않는다.
    return expect(validateUpload(candidate('a.exe'))).resolves.toMatchObject({
      ok: true,
    });
  });

  it('차단 목록에 있으면 거부한다', async () => {
    blockedSet.add('exe');
    const result = await validateUpload(candidate('setup.exe'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('BLOCKED_EXTENSION');
      expect(result.matchedExtension).toBe('exe');
      // 사용자가 "왜" 막혔는지 알 수 있어야 한다
      expect(result.message).toContain('exe');
    }
  });

  it('차단되지 않은 확장자는 통과한다', async () => {
    blockedSet.add('exe');
    await expect(validateUpload(candidate('report.pdf'))).resolves.toMatchObject({
      ok: true,
    });
  });
});

// ---------------------------------------------------------------------------
describe('우회 시도 차단', () => {
  beforeEach(() => {
    blockedSet.add('exe');
  });

  it.each([
    ['대문자', 'setup.EXE'],
    ['혼합 대소문자', 'setup.ExE'],
    ['이중 확장자 (뒤)', 'resume.pdf.exe'],
    ['이중 확장자 (앞)', 'resume.exe.pdf'],
    ['후행 점', 'setup.exe.'],
    ['후행 공백', 'setup.exe '],
    ['후행 점+공백 반복', 'setup.exe. . '],
    ['연속 점', 'setup..exe'],
    ['전각 문자', 'setup.ｅｘｅ'],
  ])('%s 우회를 막는다: %s', async (_label, filename) => {
    const result = await validateUpload(candidate(filename));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('BLOCKED_EXTENSION');
  });

  it('널바이트 우회는 파일명 단계에서 끊는다', async () => {
    const result = await validateUpload(candidate('setup.exe\u0000.png'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('ILLEGAL_CONTROL_CHAR');
  });

  it('RTLO 위장은 파일명 단계에서 끊는다', async () => {
    const result = await validateUpload(candidate('photo_\u202Egnp.exe'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('ILLEGAL_BIDI_CHAR');
  });

  it('경로 순회 시도를 끊는다', async () => {
    const result = await validateUpload(candidate('../../etc/cron.d/evil'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('ILLEGAL_PATH_SEPARATOR');
  });
});

// ---------------------------------------------------------------------------
describe('내용 기반 차단 — 확장자 정책의 사각지대', () => {
  it('확장자를 png 로 위장한 실행 파일을 잡아낸다', async () => {
    // 정책에 png 는 없다. 확장자 검사만 했다면 이 파일은 통과한다.
    blockedSet.add('exe');

    const result = await validateUpload(candidate('photo.png', PE_HEAD));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('EXECUTABLE_SIGNATURE');
      expect(result.sniffedType).toBe('executable-pe');
    }
  });

  it('확장자가 아예 없는 실행 파일도 잡아낸다', async () => {
    const result = await validateUpload(candidate('installer', PE_HEAD));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('EXECUTABLE_SIGNATURE');
  });

  it('shebang 스크립트를 txt 로 위장해도 잡아낸다', async () => {
    const shebang = new TextEncoder().encode('#!/bin/bash\nrm -rf /');
    const result = await validateUpload(candidate('memo.txt', shebang));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('EXECUTABLE_SIGNATURE');
  });

  it('정상 PDF 는 통과한다', async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    const result = await validateUpload(candidate('report.pdf', pdf));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sniffedType).toBe('document-pdf');
  });
});

// ---------------------------------------------------------------------------
describe('검사 순서', () => {
  /**
   * 순서가 바뀌면 로그의 의미가 달라진다.
   * "exe 라서 막혔다"와 "파일명이 위조돼서 막혔다"는 다른 사건이므로,
   * 더 근본적인 사유가 먼저 보고되어야 한다.
   */
  it('파일명 위조가 확장자 정책보다 먼저 보고된다', async () => {
    blockedSet.add('exe');
    const result = await validateUpload(candidate('a.exe\u0000.png'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('ILLEGAL_CONTROL_CHAR');
  });

  it('확장자 정책이 매직넘버 검사보다 먼저 보고된다', async () => {
    // exe 확장자 + PE 내용. 둘 다 걸리지만 확장자 사유가 나와야 한다.
    blockedSet.add('exe');
    const result = await validateUpload(candidate('setup.exe', PE_HEAD));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('BLOCKED_EXTENSION');
  });
});

// ---------------------------------------------------------------------------
describe('크기 경계값', () => {
  it('빈 파일을 거부한다', async () => {
    const result = await validateUpload({
      filename: 'empty.txt',
      sizeBytes: 0,
      head: new Uint8Array(0),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('EMPTY_FILE');
  });

  it('상한과 정확히 같은 크기는 허용한다', async () => {
    const result = await validateUpload(
      candidate('big.txt', TEXT_HEAD, MAX_FILE_SIZE_BYTES)
    );
    expect(result.ok).toBe(true);
  });

  it('상한을 1바이트 넘으면 거부한다', async () => {
    const result = await validateUpload(
      candidate('big.txt', TEXT_HEAD, MAX_FILE_SIZE_BYTES + 1)
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('FILE_TOO_LARGE');
  });
});
