import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '파일 확장자 차단 정책 관리',
  description:
    '확장자 차단 정책을 관리하고, 그 정책이 실제 업로드에서 강제되는지 확인합니다.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
