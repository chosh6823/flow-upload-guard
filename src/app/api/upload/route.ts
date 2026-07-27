/**
 * POST /api/upload — 실제 파일 업로드
 *
 * 과제 명세 B: "정책이 실제 업로드에서 강제되는 것"까지가 최소 범위.
 * 그 강제가 일어나는 지점이 여기다.
 *
 * 이 핸들러는 validateUpload() 를 거치지 않고 storeFile() 을 호출할 수 있는
 * 경로를 만들지 않는다. 검증과 저장이 한 함수 안에서 순서대로 일어난다.
 */

import { NextResponse } from 'next/server';
import { validateUpload } from '@/lib/upload/validate';
import { storeFile } from '@/lib/upload/storage';
import { recordUpload } from '@/lib/upload/repository';
import { MAX_FILE_SIZE_BYTES } from '@/lib/config';

export const dynamic = 'force-dynamic';
// Node 런타임 필요: pg 커넥션과 node:fs 를 쓴다.
export const runtime = 'nodejs';

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      {
        code: 'INVALID_FORM',
        message: 'multipart/form-data 형식이 아니거나 본문이 손상되었습니다.',
      },
      { status: 400 }
    );
  }

  const entry = form.get('file');

  if (!entry || typeof entry === 'string') {
    return NextResponse.json(
      { code: 'NO_FILE', message: '업로드할 파일이 없습니다.' },
      { status: 400 }
    );
  }

  const file = entry as File;

  // 크기는 바이트를 메모리에 올리기 *전에* 본다.
  // 여기서 안 끊으면 4MB 제한이 있어도 400MB 짜리를 일단 다 읽고 나서 거절하게 된다.
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const rejected = await recordUpload({
      originalName: safeName(file.name),
      storedName: null,
      sizeBytes: file.size,
      status: 'REJECTED',
      rejectReason: 'FILE_TOO_LARGE',
      matchedExtension: null,
      sniffedType: null,
    });

    return NextResponse.json(
      {
        code: 'FILE_TOO_LARGE',
        message: `파일 크기가 상한(${Math.round(
          MAX_FILE_SIZE_BYTES / 1024 / 1024
        )}MB)을 초과했습니다.`,
        recordId: rejected,
      },
      { status: 413 }
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  const verdict = await validateUpload({
    // 클라이언트가 보낸 파일명. 여기서부터 신뢰할 수 없는 입력이다.
    filename: file.name,
    sizeBytes: bytes.byteLength,
    head: bytes,
  });

  if (!verdict.ok) {
    // 차단된 시도야말로 기록할 가치가 있다.
    // 같은 세션에서 a.exe → a.EXE → a.exe.png 순서로 들어오면 그건 우회 공격이고,
    // 이 로그가 그걸 탐지할 유일한 신호다.
    const recordId = await recordUpload({
      originalName: safeName(file.name),
      storedName: null,
      sizeBytes: verdict.sizeBytes,
      status: 'REJECTED',
      rejectReason: verdict.reason,
      matchedExtension: verdict.matchedExtension ?? null,
      sniffedType: verdict.sniffedType ?? null,
    });

    return NextResponse.json(
      {
        code: verdict.reason,
        message: verdict.message,
        matchedExtension: verdict.matchedExtension ?? null,
        sniffedType: verdict.sniffedType ?? null,
        recordId,
      },
      { status: 400 }
    );
  }

  const stored = await storeFile(bytes);

  const recordId = await recordUpload({
    originalName: verdict.filename,
    storedName: stored.storedName,
    sizeBytes: verdict.sizeBytes,
    status: 'ACCEPTED',
    rejectReason: null,
    matchedExtension: null,
    sniffedType: verdict.sniffedType,
  });

  return NextResponse.json(
    {
      message: '업로드가 완료되었습니다.',
      file: {
        originalName: verdict.filename,
        storedName: stored.storedName,
        sizeBytes: verdict.sizeBytes,
        sniffedType: verdict.sniffedType,
        // 서버리스 데모에서는 본문을 보관하지 않는다는 사실을 숨기지 않는다.
        persisted: stored.persisted,
      },
      recordId,
    },
    { status: 201 }
  );
}

/**
 * 로그 컬럼(VARCHAR 255)에 넣기 위한 안전한 문자열.
 * 제어문자를 그대로 로그에 남기면 로그 뷰어가 깨지거나 로그 인젝션이 된다.
 */
function safeName(name: string): string {
  return name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '?')
    .slice(0, 255);
}
