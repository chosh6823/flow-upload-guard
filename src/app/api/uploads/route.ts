/**
 * GET /api/uploads — 최근 업로드 시도 기록 (성공 + 차단)
 *
 * 데모/검증용. 정책이 실제로 강제되고 있다는 것을 화면에서 바로 보여준다.
 */

import { NextResponse } from 'next/server';
import { listRecentUploads } from '@/lib/upload/repository';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    return NextResponse.json({ uploads: await listRecentUploads(15) });
  } catch (error) {
    console.error('[api/uploads]', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: '서버에서 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
