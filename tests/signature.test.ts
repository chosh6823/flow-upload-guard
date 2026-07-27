import { describe, it, expect } from 'vitest';
import { sniffSignature } from '@/lib/upload/signature';

/** 테스트용 바이트 배열 헬퍼 */
function bytes(...values: number[]): Uint8Array {
  return new Uint8Array([...values, ...new Array(16).fill(0x00)]).subarray(0, 16);
}

describe('sniffSignature — 매직넘버 판별', () => {
  describe('실행 파일을 잡아낸다', () => {
    it('Windows PE (MZ)', () => {
      const result = sniffSignature(bytes(0x4d, 0x5a, 0x90, 0x00));
      expect(result).toEqual({ type: 'executable-pe', executable: true });
    });

    it('Linux ELF', () => {
      const result = sniffSignature(bytes(0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01));
      expect(result).toEqual({ type: 'executable-elf', executable: true });
    });

    it('macOS Mach-O (64bit LE)', () => {
      const result = sniffSignature(bytes(0xcf, 0xfa, 0xed, 0xfe));
      expect(result).toEqual({ type: 'executable-macho', executable: true });
    });

    it('Java class', () => {
      const result = sniffSignature(bytes(0xca, 0xfe, 0xba, 0xbe));
      expect(result).toEqual({ type: 'java-class', executable: true });
    });

    it('shebang 스크립트', () => {
      // "#!/bin/sh"
      const result = sniffSignature(
        new TextEncoder().encode('#!/bin/sh\necho hi')
      );
      expect(result).toEqual({ type: 'script-shebang', executable: true });
    });
  });

  describe('일반 파일은 실행으로 보지 않는다', () => {
    it.each([
      ['PNG', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image-png'],
      ['JPEG', [0xff, 0xd8, 0xff, 0xe0], 'image-jpeg'],
      ['GIF', [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 'image-gif'],
      ['PDF', [0x25, 0x50, 0x44, 0x46, 0x2d], 'document-pdf'],
      ['ZIP', [0x50, 0x4b, 0x03, 0x04], 'archive-zip'],
    ])('%s', (_label, magic, expected) => {
      const result = sniffSignature(bytes(...magic));
      expect(result.type).toBe(expected);
      expect(result.executable).toBe(false);
    });
  });

  it('평범한 텍스트는 unknown 이다', () => {
    const result = sniffSignature(new TextEncoder().encode('안녕하세요 텍스트'));
    expect(result).toEqual({ type: 'unknown', executable: false });
  });

  it('빈 버퍼에서도 예외 없이 unknown 을 돌려준다', () => {
    expect(sniffSignature(new Uint8Array(0))).toEqual({
      type: 'unknown',
      executable: false,
    });
  });

  it('시그니처보다 짧은 버퍼를 안전하게 처리한다', () => {
    // MZ 의 M 만 있는 1바이트. 배열 범위를 벗어나 읽으면 안 된다.
    expect(sniffSignature(new Uint8Array([0x4d]))).toEqual({
      type: 'unknown',
      executable: false,
    });
  });

  /**
   * 이 테스트가 "확장자 차단만으로는 부족하다"는 명제의 증거다.
   * 파일명은 photo.png 지만 내용은 Windows 실행 파일인 경우.
   */
  it('이름만 바꾼 실행 파일을 내용으로 잡아낸다', () => {
    const renamedExe = bytes(0x4d, 0x5a, 0x90, 0x00, 0x03);
    expect(sniffSignature(renamedExe).executable).toBe(true);
  });
});
