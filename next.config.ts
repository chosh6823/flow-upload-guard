import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * 보안 응답 헤더.
   *
   * 업로드 기능이 있는 서비스에서 특히 의미 있는 두 가지:
   *  - X-Content-Type-Options: nosniff
   *      브라우저가 Content-Type 을 무시하고 내용으로 타입을 추측하는 동작을 끈다.
   *      업로드된 파일이 text/plain 으로 내려가도 HTML 로 해석되는 사고를 막는다.
   *  - Content-Security-Policy
   *      혹시 저장형 XSS 가 성립하더라도 외부로 데이터를 보내기 어렵게 한다.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // Next.js 의 인라인 부트스트랩 스크립트 때문에 unsafe-inline 이 필요하다.
              // nonce 기반으로 좁힐 수 있으나 과제 범위를 넘어선다(CONSIDERATIONS.md §5-5).
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
