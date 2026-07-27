import Link from 'next/link';
import PolicyEditor from '@/components/PolicyEditor';
import {
  listExtensions,
  countCustomExtensions,
} from '@/lib/extension/repository';
import { MAX_CUSTOM_EXTENSIONS, MAX_EXTENSION_LENGTH } from '@/lib/config';

/**
 * 차단 정책 관리 화면.
 *
 * 업로드 화면(/)의 "차단 정책 설정" 버튼으로 진입한다.
 *
 * ⚠ 실제 서비스라면 이 페이지는 **관리자만** 접근할 수 있어야 한다.
 *   지금은 인증이 없어 누구나 차단을 해제할 수 있다.
 *   과제가 "누구나 접속 가능한 URL"을 요구해 의도적으로 제외한 것이며,
 *   이 애플리케이션의 가장 큰 미비점으로 CONSIDERATIONS.md §7-2 에 명시했다.
 */
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [extensions, customCount] = await Promise.all([
    listExtensions(),
    countCustomExtensions(),
  ]);

  return (
    <main>
      <header className="page-header">
        <div>
          <Link href="/" className="back-link">
            <BackIcon />
            파일 업로드로 돌아가기
          </Link>
          <h1>차단 정책 설정</h1>
          <p className="subtitle">
            여기서 설정한 정책이 업로드 시 서버에서 강제됩니다.
          </p>
        </div>
      </header>

      <div className="notice">
        이 화면은 본래 관리자 전용입니다. 과제 요건(누구나 접속 가능한 URL) 때문에
        인증을 두지 않았습니다 — 자세한 근거는 <code>CONSIDERATIONS.md §7-2</code>.
      </div>

      <PolicyEditor
        initialExtensions={extensions}
        initialCustomCount={customCount}
        maxCustom={MAX_CUSTOM_EXTENSIONS}
        maxLength={MAX_EXTENSION_LENGTH}
      />

      <p className="footnote">
        입력 제한(<code>maxLength</code>, 버튼 비활성화)은 편의를 위한 것입니다.
        실제 강제는 서버와 DB 제약에서 이루어지므로, API 를 직접 호출해 21자를
        보내거나 중복을 추가해도 동일하게 거부됩니다.
      </p>
    </main>
  );
}

function BackIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}
