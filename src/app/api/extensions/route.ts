/**
 * GET  /api/extensions  — 정책 전체 조회
 * POST /api/extensions  — 커스텀 확장자 추가
 */

import { NextResponse } from 'next/server';
import { normalizeExtension } from '@/lib/extension/normalize';
import {
  listExtensions,
  countCustomExtensions,
  addCustomExtension,
} from '@/lib/extension/repository';
import { MAX_CUSTOM_EXTENSIONS, MAX_EXTENSION_LENGTH } from '@/lib/config';

// 정책은 항상 최신이어야 한다. Next.js 의 라우트 캐싱을 끈다.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [rows, customCount] = await Promise.all([
      listExtensions(),
      countCustomExtensions(),
    ]);

    return NextResponse.json({
      extensions: rows,
      limits: {
        maxCustom: MAX_CUSTOM_EXTENSIONS,
        maxLength: MAX_EXTENSION_LENGTH,
        customCount,
      },
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: 'INVALID_BODY', message: '요청 본문이 올바른 JSON 이 아닙니다.' },
      { status: 400 }
    );
  }

  const raw = (body as { extension?: unknown } | null)?.extension;

  // 클라이언트가 maxLength 로 막아 주지만, 서버는 그걸 믿지 않는다.
  // 이 검증이 실질적인 강제 지점이다.
  const normalized = normalizeExtension(raw);
  if (!normalized.ok) {
    return NextResponse.json(
      { code: normalized.code, message: normalized.message },
      { status: 400 }
    );
  }

  try {
    const result = await addCustomExtension(normalized.value);

    if (!result.ok) {
      // DUPLICATE → 409, LIMIT_EXCEEDED → 409.
      // 둘 다 "요청 자체는 올바르지만 현재 상태와 충돌"이므로 409 가 맞다.
      return NextResponse.json(
        { code: result.code, message: result.message },
        { status: 409 }
      );
    }

    return NextResponse.json({ extension: result.row }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}

function serverError(error: unknown) {
  // 내부 에러 메시지(스택, SQL, 커넥션 문자열)를 클라이언트로 흘리지 않는다.
  console.error('[api/extensions]', error);
  return NextResponse.json(
    { code: 'INTERNAL_ERROR', message: '서버에서 오류가 발생했습니다.' },
    { status: 500 }
  );
}
