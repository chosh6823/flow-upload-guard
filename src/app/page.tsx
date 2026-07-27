import Link from 'next/link';
import UploadPanel from '@/components/UploadPanel';
import { countBlockedExtensions } from '@/lib/extension/repository';
import { listRecentUploads } from '@/lib/upload/repository';
import { MAX_FILE_SIZE_BYTES } from '@/lib/config';

/**
 * 메인 화면 = 파일 업로드.
 *
 * 차단 정책 관리는 이 화면의 "설정" 버튼으로 들어가는 별도 페이지(/settings)다.
 * 업로드는 모든 사용자가 매일 쓰는 기능이고, 정책 관리는 드물게 관리자가 쓰는
 * 기능이므로 같은 화면에 나란히 두면 사용 빈도와 권한 수준이 뒤섞인다.
 * (근거: CONSIDERATIONS.md §2-4)
 *
 * 서버 컴포넌트에서 초기 상태를 직접 읽어, 첫 렌더부터 정확한 값이 보이게 한다.
 */
export const dynamic = 'force-dynamic';

export default async function UploadPage() {
  const [blockedCount, uploads] = await Promise.all([
    countBlockedExtensions(),
    listRecentUploads(15),
  ]);

  return (
    <main>
      <header className="page-header">
        <div>
          <h1>파일 업로드</h1>
          <p className="subtitle">
            {blockedCount === 0 ? (
              <>
                현재 차단 중인 확장자가 <strong>없습니다</strong>. 설정에서 정책을
                켤 수 있습니다.
              </>
            ) : (
              <>
                현재 <strong>{blockedCount}개</strong> 확장자가 차단 중입니다.
              </>
            )}
          </p>
        </div>

        {/*
          업로드 화면에는 차단 "개수"만 보여주고 목록은 보여주지 않는다.
          정책이 켜져 있는지는 업로드하는 사람이 알아야 하지만,
          차단 목록 전체는 정책 관리 권한을 가진 사람이 볼 정보다.
        */}
        <Link href="/settings" className="btn-icon" aria-label="차단 정책 설정">
          <GearIcon />
          <span>차단 정책 설정</span>
        </Link>
      </header>

      <UploadPanel
        initialUploads={uploads}
        maxFileSizeMB={Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024)}
      />

      <p className="footnote">
        이 화면은 업로드 전에 아무것도 미리 거르지 않습니다. 파일을 그대로 서버로
        보내고 서버의 판정 결과를 표시하므로, <code>curl</code> 로 API 를 직접
        호출해도 동일하게 차단됩니다.
        <br />
        검증 시나리오는 저장소의 <code>scripts/verify.sh</code> 를 참고하세요.
      </p>
    </main>
  );
}

function GearIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
