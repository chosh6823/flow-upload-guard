/**
 * PATCH  /api/extensions/:id  — 고정 확장자 체크/언체크
 * DELETE /api/extensions/:id  — 커스텀 확장자 삭제
 *
 * 두 동작을 id 로만 구분하지 않는다는 점이 중요하다.
 * repository 의 SQL 이 `WHERE id = $1 AND type = 'FIXED'` / `= 'CUSTOM'` 을
 * 조건에 포함하므로, id 를 조작해 고정 확장자를 DELETE 하는 것은 불가능하다.
 * 권한 검사를 애플리케이션 if 문이 아니라 쿼리 조건으로 내린 것이다.
 */

import { NextResponse } from 'next/server';
import {
  setFixedExtensionBlocked,
  removeCustomExtension,
} from '@/lib/extension/repository';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;

  if (!isPositiveInteger(id)) {
    return NextResponse.json(
      { code: 'INVALID_ID', message: '잘못된 식별자입니다.' },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: 'INVALID_BODY', message: '요청 본문이 올바른 JSON 이 아닙니다.' },
      { status: 400 }
    );
  }

  const isBlocked = (body as { isBlocked?: unknown } | null)?.isBlocked;
  if (typeof isBlocked !== 'boolean') {
    return NextResponse.json(
      { code: 'INVALID_BODY', message: 'isBlocked 는 boolean 이어야 합니다.' },
      { status: 400 }
    );
  }

  try {
    const row = await setFixedExtensionBlocked(id, isBlocked);

    if (!row) {
      return NextResponse.json(
        {
          code: 'NOT_FOUND',
          message: '고정 확장자를 찾을 수 없습니다.',
        },
        { status: 404 }
      );
    }

    return NextResponse.json({ extension: row });
  } catch (error) {
    console.error('[api/extensions/:id PATCH]', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: '서버에서 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;

  if (!isPositiveInteger(id)) {
    return NextResponse.json(
      { code: 'INVALID_ID', message: '잘못된 식별자입니다.' },
      { status: 400 }
    );
  }

  try {
    const removed = await removeCustomExtension(id);

    if (!removed) {
      // 이미 지워졌거나, 고정 확장자를 지우려 한 경우.
      // 어느 쪽인지 구분해 알려줄 실익이 없어 404 로 통일한다.
      return NextResponse.json(
        { code: 'NOT_FOUND', message: '삭제할 커스텀 확장자를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('[api/extensions/:id DELETE]', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: '서버에서 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

/** BIGSERIAL id. 숫자가 아닌 값이 SQL 로 내려가지 않게 여기서 끊는다. */
function isPositiveInteger(value: string): boolean {
  return /^[1-9][0-9]{0,18}$/.test(value);
}
