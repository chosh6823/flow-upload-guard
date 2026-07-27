import { describe, it, expect } from 'vitest';
import {
  normalizeExtension,
  extractExtensions,
  inspectFilename,
} from '@/lib/extension/normalize';

/**
 * 이 테스트 파일은 사실상 "정규화 규칙 명세서"다.
 * 규칙을 문서로만 적어두면 코드가 조용히 어긋나지만,
 * 테스트로 적어두면 어긋나는 순간 빨간불이 켜진다.
 */

// ---------------------------------------------------------------------------
describe('normalizeExtension — 정책 입력 정규화', () => {
  it('평범한 입력은 그대로 통과한다', () => {
    expect(normalizeExtension('sh')).toEqual({ ok: true, value: 'sh' });
  });

  // 명세의 "중복 추가 방지 (sh 추가 후 다시 sh)" 는
  // 아래 변형들이 전부 'sh' 로 접혀야만 성립한다.
  it.each([
    ['대문자', 'SH'],
    ['혼합 대소문자', 'Sh'],
    ['선행 점', '.sh'],
    ['선행 점 2개', '..sh'],
    ['앞뒤 공백', '  sh  '],
    ['비단절 공백', '\u00A0sh\u00A0'],
    ['전각 문자', 'ｓｈ'],
    ['점 + 대문자 + 공백', ' .SH '],
  ])('%s 는 sh 로 정규화된다', (_label, input) => {
    expect(normalizeExtension(input)).toEqual({ ok: true, value: 'sh' });
  });

  it('숫자를 포함한 확장자를 허용한다', () => {
    expect(normalizeExtension('mp4')).toEqual({ ok: true, value: 'mp4' });
    expect(normalizeExtension('7z')).toEqual({ ok: true, value: '7z' });
  });

  // ---- 경계값 -------------------------------------------------------------
  it('정확히 20자는 허용한다', () => {
    const twenty = 'a'.repeat(20);
    expect(normalizeExtension(twenty)).toEqual({ ok: true, value: twenty });
  });

  it('21자는 TOO_LONG 으로 거부한다', () => {
    const result = normalizeExtension('a'.repeat(21));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('TOO_LONG');
  });

  it('1자는 허용한다', () => {
    expect(normalizeExtension('c')).toEqual({ ok: true, value: 'c' });
  });

  // ---- 거부 케이스 --------------------------------------------------------
  it.each([
    ['빈 문자열', '', 'EMPTY'],
    ['공백만', '   ', 'EMPTY'],
    ['점만', '...', 'EMPTY'],
    ['경로 순회 시도', '../etc', 'INVALID_CHARS'],
    ['슬래시 포함', 'sh/x', 'INVALID_CHARS'],
    ['와일드카드', '*', 'INVALID_CHARS'],
    ['한글', '실행', 'INVALID_CHARS'],
    ['중간 점', 'tar.gz', 'INVALID_CHARS'],
    ['하이픈', 'my-ext', 'INVALID_CHARS'],
    ['공백 포함', 'a b', 'INVALID_CHARS'],
    ['널바이트 포함', 'sh\u0000', 'INVALID_CHARS'],
  ])('%s 는 %s 로 거부한다', (_label, input, code) => {
    const result = normalizeExtension(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(code);
  });

  it('문자열이 아닌 입력을 안전하게 거부한다', () => {
    for (const bad of [null, undefined, 42, {}, [], true]) {
      expect(normalizeExtension(bad).ok).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
describe('extractExtensions — 파일명에서 확장자 추출', () => {
  it('단일 확장자', () => {
    expect(extractExtensions('report.pdf')).toEqual(['pdf']);
  });

  it('확장자가 없으면 빈 배열', () => {
    expect(extractExtensions('Dockerfile')).toEqual([]);
    expect(extractExtensions('README')).toEqual([]);
  });

  it('dotfile 의 이름 부분은 확장자가 아니다', () => {
    // .bashrc 의 bashrc 를 확장자로 보면 오탐이 생긴다
    expect(extractExtensions('.bashrc')).toEqual([]);
    expect(extractExtensions('.gitignore')).toEqual([]);
  });

  it('dotfile 이어도 진짜 확장자는 잡는다', () => {
    expect(extractExtensions('.bashrc.exe')).toEqual(['exe']);
  });

  // ---- 우회 기법 ----------------------------------------------------------
  it('대소문자 우회를 막는다', () => {
    expect(extractExtensions('virus.EXE')).toEqual(['exe']);
    expect(extractExtensions('virus.ExE')).toEqual(['exe']);
  });

  it('이중 확장자를 모두 잡는다 (기본 all 모드)', () => {
    // Windows 에서 확장자 숨김이 켜져 있으면 사용자에겐 "resume.pdf" 로 보인다
    expect(extractExtensions('resume.pdf.exe')).toEqual(['pdf', 'exe']);
    // Apache mod_mime 계열이 중간 확장자를 핸들러로 해석하던 고전적 사고
    expect(extractExtensions('shell.php.jpg')).toEqual(['php', 'jpg']);
  });

  it('후행 점을 제거한 뒤 검사한다', () => {
    // Windows 는 "a.exe." 를 만들 때 뒤의 점을 잘라 결국 a.exe 가 된다
    expect(extractExtensions('a.exe.')).toEqual(['exe']);
    expect(extractExtensions('a.exe...')).toEqual(['exe']);
  });

  it('후행 공백을 제거한 뒤 검사한다', () => {
    expect(extractExtensions('a.exe ')).toEqual(['exe']);
    expect(extractExtensions('a.exe   ')).toEqual(['exe']);
    expect(extractExtensions('a.exe\u00A0')).toEqual(['exe']);
    expect(extractExtensions('a.exe. . ')).toEqual(['exe']);
  });

  it('연속된 점 사이의 빈 구간은 무시한다', () => {
    expect(extractExtensions('a..exe')).toEqual(['exe']);
    expect(extractExtensions('a...exe')).toEqual(['exe']);
  });

  it('전각 문자 우회를 막는다', () => {
    expect(extractExtensions('virus.ｅｘｅ')).toEqual(['exe']);
  });

  it('중복 확장자를 한 번만 보고한다', () => {
    expect(extractExtensions('a.exe.exe')).toEqual(['exe']);
  });

  it('일반적인 다중 확장자도 모두 반환한다', () => {
    expect(extractExtensions('archive.tar.gz')).toEqual(['tar', 'gz']);
  });
});

// ---------------------------------------------------------------------------
describe('inspectFilename — 파일명 자체의 정당성', () => {
  it('정상 파일명을 통과시킨다', () => {
    const result = inspectFilename('보고서 최종.pdf');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.extensions).toEqual(['pdf']);
  });

  it('널바이트가 든 파일명을 거부한다', () => {
    // "a.png" 로 보이지만 C 문자열 기반 계층에서는 "a.exe" 로 잘린다
    const result = inspectFilename('a.exe\u0000.png');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ILLEGAL_CONTROL_CHAR');
  });

  it('개행 등 제어문자가 든 파일명을 거부한다', () => {
    const result = inspectFilename('a\n.pdf');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ILLEGAL_CONTROL_CHAR');
  });

  it('RTLO 로 확장자를 위장한 파일명을 거부한다', () => {
    // 화면에는 "photo_exe.png" 로 보이지만 실제로는 .exe 파일이다
    const rtlo = 'photo_\u202Egnp.exe';
    const result = inspectFilename(rtlo);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ILLEGAL_BIDI_CHAR');
  });

  it('제로폭 문자가 든 파일명을 거부한다', () => {
    const result = inspectFilename('a\u200B.exe');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ILLEGAL_BIDI_CHAR');
  });

  it.each([
    ['유닉스 경로 순회', '../../etc/passwd'],
    ['윈도우 경로', 'C:\\Windows\\System32\\evil.exe'],
    ['슬래시 포함', 'a/b.txt'],
  ])('%s 를 거부한다', (_label, name) => {
    const result = inspectFilename(name);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ILLEGAL_PATH_SEPARATOR');
  });

  it('255자를 넘는 파일명을 거부한다', () => {
    const result = inspectFilename('a'.repeat(252) + '.txt');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('FILENAME_TOO_LONG');
  });

  it('정확히 255자는 허용한다', () => {
    const name = 'a'.repeat(251) + '.txt';
    expect(name.length).toBe(255);
    expect(inspectFilename(name).ok).toBe(true);
  });

  it('빈 파일명을 거부한다', () => {
    const result = inspectFilename('');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('EMPTY_FILENAME');
  });
});

// ---------------------------------------------------------------------------
describe('정규화 규칙의 양방향 일치', () => {
  /**
   * 이 테스트가 이 파일에서 가장 중요하다.
   *
   * 정책 입력 정규화(normalizeExtension)와 파일명 확장자 추출(extractExtensions)이
   * 서로 다른 규칙을 쓰면, 정책에는 'exe' 가 저장돼 있는데 파일명에서는 'EXE' 가
   * 나와서 매칭에 실패한다 — 정책이 있는데 안 막히는 최악의 상태다.
   *
   * 두 함수의 출력이 항상 같은 표준형에 도달하는지 직접 확인한다.
   */
  it.each([
    ['exe', 'a.exe'],
    ['exe', 'a.EXE'],
    ['exe', 'a.ExE'],
    ['exe', 'a.exe.'],
    ['exe', 'a.exe '],
    ['exe', 'a.ｅｘｅ'],
    ['sh', 'script.SH'],
    ['js', 'app.JS'],
  ])(
    "정책 '%s' 는 파일 '%s' 를 매칭한다",
    (policyInput, filename) => {
      const policy = normalizeExtension(policyInput);
      expect(policy.ok).toBe(true);
      if (!policy.ok) return;

      expect(extractExtensions(filename)).toContain(policy.value);
    }
  );
});
