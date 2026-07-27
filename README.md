# flow-upload-guard

확장자 차단 정책을 관리하고, **그 정책이 실제 업로드에서 강제되는지**까지 확인할 수 있는 애플리케이션입니다.

- **배포 주소**: (배포 후 여기에 기입)
- **고려사항 문서**: [`CONSIDERATIONS.md`](./CONSIDERATIONS.md) — 기획·보안·예외에 대한 판단과 근거
- **AI 활용 기록**: [`PROMPT_LOG.md`](./PROMPT_LOG.md) — 프롬프트 시간순 기록, 사용 도구, 회고
- **테이블 스키마**: [`docs/schema.sql`](./docs/schema.sql) — 실행되는 DDL 그 자체

---

## 1. 화면 구성

```
/                 파일 업로드 (메인)
                  ├ 상단에 "현재 N개 확장자가 차단 중" + [⚙ 차단 정책 설정] 버튼
                  ├ 드래그&드롭 업로드 — 화면에서 미리 거르지 않고 서버로 전송
                  └ 최근 업로드 시도 기록 (차단된 시도 포함)

/settings         차단 정책 설정  ← 위 버튼으로 진입
                  ├ 고정 확장자 7종 체크박스 (기본 unCheck)
                  └ 커스텀 확장자 추가/삭제 (20자 · 200개)
```

두 기능을 분리한 이유는 **사용 빈도와 권한 수준이 다르기** 때문입니다. 업로드는 모든 사용자가 매일 쓰지만, 정책 관리는 드물게 관리자가 쓰고 실수하면 보안 정책이 꺼집니다. 라우트를 나눠 두면 인증 도입 시 **미들웨어에서 `/settings` 경로 하나만 막으면** 됩니다. (근거: `CONSIDERATIONS.md` §2-4)

업로드 화면에는 차단 **개수만** 표시하고 목록은 보여주지 않습니다 — 정책이 켜져 있는지는 업로드하는 사람이 알아야 하지만, 차단 목록 전체는 정책 관리 권한을 가진 사람이 볼 정보이기 때문입니다.

---

## 2. 무엇을 만들었는가

| 명세 | 구현 |
|---|---|
| 고정 확장자 7종(`bat cmd com cpl exe scr js`), 기본 unCheck | DB seed 로 `is_blocked = FALSE` 상태로 주입 |
| check/uncheck 시 DB 저장, 새로고침 시 유지 | `PATCH /api/extensions/:id` → 서버 컴포넌트가 초기 상태를 직접 읽음 |
| 고정 확장자는 커스텀 영역에 표시되지 않음 | `type` 컬럼으로 구분, UI 에서 분리 렌더 |
| 커스텀 확장자 최대 20자 | 브라우저 `maxLength` + 서버 검증 + DB `CHECK` 3중 |
| 최대 200개 | advisory lock 으로 직렬화된 카운트 검사 (동시 요청에도 안 뚫림) |
| `X` 클릭 시 DB 삭제 | `DELETE /api/extensions/:id`, 삭제 이력은 감사 로그에 |
| 중복 추가 방지 | 정규화 후 비교 + `UNIQUE` 제약이 최종 방어선 |
| **정책이 실제 업로드에 적용** | `POST /api/upload` 가 유일한 강제 지점 |
| 차단 시 명확한 사유 | 사유 코드 + 한국어 메시지 + 어떤 확장자 때문인지 명시 |

명세를 넘어서 추가한 것 (근거는 `CONSIDERATIONS.md`):

- 파일명 우회 차단 — 대소문자 / 이중 확장자 / 후행 점·공백 / 널바이트 / RTLO / 경로 순회 / 전각 문자
- **매직넘버(파일 시그니처) 검증** — 이름만 `photo.png` 로 바꾼 실행 파일을 내용으로 잡아냄
- 정책 변경 감사 로그, 업로드 시도 기록(차단 포함)
- 보안 응답 헤더 (`nosniff`, CSP, `frame-ancestors`)

---

## 3. 기술 스택

| 영역 | 선택 | 이유 |
|---|---|---|
| 프레임워크 | Next.js 15 (App Router) | 프론트/API 단일 레포. Vercel 무료 티어에 콜드 스타트가 없어 "면접 당일 접속 가능" 요건에 유리 |
| DB | PostgreSQL | 부분 인덱스, `CHECK` 제약, advisory lock — 이 과제에서 실제로 다 씀 |
| DB 접근 | `pg` (node-postgres) + 직접 작성한 SQL | ORM 을 쓰지 않은 이유는 아래 |
| 테스트 | Vitest | 단위 94개 + 동시성 통합 6개 |

> **ORM 을 쓰지 않은 이유**
> 과제 제출물에 "table schema" 를 포함해야 합니다. ORM 을 쓰면 스키마 정의(ORM DSL) → 마이그레이션 SQL → 문서상의 DDL 이 세 갈래로 갈라지고, 그중 어느 것이 진짜인지 흐려집니다.
> `docs/schema.sql` 하나를 단일 출처로 두고 `scripts/migrate.ts` 가 그 파일을 **그대로 실행**하면 그 위험이 사라집니다. 문서에 적힌 DDL 이 곧 돌아가는 DDL 입니다.
> (부수 효과로 서버리스 콜드 스타트도 가벼워집니다)

---

## 4. 실행 방법

### 4-1. 사전 준비

- Node.js 20 이상
- PostgreSQL 14 이상 (로컬 또는 Neon / Supabase 등 무료 관리형)

### 4-2. 로컬 실행

```bash
git clone <repo-url>
cd flow-upload-guard

npm install

# 환경변수 설정
cp .env.example .env
# .env 의 DATABASE_URL 을 본인 환경에 맞게 수정

# 스키마 생성 + 고정 확장자 7종 seed (재실행 안전)
npm run db:migrate

npm run dev
# http://localhost:3000
```

### 4-3. 테스트

```bash
# 단위 테스트 (DB 불필요) — 94개
npm test

# 동시성 통합 테스트 포함 (DB 필요) — +6개
DATABASE_URL='postgresql://...' npx vitest run

# 서버 강제 검증 (서버가 떠 있어야 함) — 36개 시나리오
./scripts/verify.sh http://localhost:3000
```

### 4-4. 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `DATABASE_URL` | (필수) | Postgres 연결 문자열. 서버리스에서는 **pooler 엔드포인트** 사용 |
| `EXTENSION_SCAN_MODE` | `all` | `all`=모든 점 구간 검사 / `last`=마지막 확장자만 |
| `BLOCK_EXECUTABLE_SIGNATURE` | `true` | 매직넘버로 실행 파일 차단 |
| `STORAGE_DRIVER` | `none` | `none`=검증만 하고 본문 폐기 / `local`=디스크 저장 |
| `STORAGE_DIR` | `./storage` | `local` 드라이버의 저장 경로 (반드시 `public/` 바깥) |
| `PGPOOL_MAX` | `3` | 커넥션 풀 크기 |

---

## 5. 배포 (Vercel + Neon 기준, 약 5분)

1. **Postgres 준비** — [Neon](https://neon.tech) 무료 플랜에서 프로젝트 생성 → **Pooled connection** 문자열 복사
   (`-pooler` 가 포함된 주소여야 합니다. 직결 주소는 서버리스에서 커넥션이 금방 고갈됩니다)

2. **스키마 적용** — 로컬에서 원격 DB 를 향해 한 번 실행

   ```bash
   DATABASE_URL='postgresql://...-pooler.../neondb?sslmode=require' npm run db:migrate
   ```

3. **Vercel 배포**

   ```bash
   npm i -g vercel
   vercel            # 프로젝트 연결
   vercel env add DATABASE_URL production   # 위 pooled 문자열 입력
   vercel --prod
   ```

   또는 GitHub 에 push 후 Vercel 대시보드에서 Import → Environment Variables 에 `DATABASE_URL` 추가.

4. **확인**

   ```bash
   ./scripts/verify.sh https://<your-app>.vercel.app
   ```

> **배포 환경 주의**
> - Vercel 은 파일시스템이 휘발됩니다. 그래서 기본값이 `STORAGE_DRIVER=none` 입니다 — 검증은 정상 수행하되 파일 본문은 보관하지 않고, 그 사실을 응답에 명시합니다. "저장된 것처럼 보이지만 실제로는 없는" 상태를 만들지 않기 위한 선택입니다.
> - Vercel Serverless Function 의 요청 본문 상한은 4.5MB 입니다. 앱 상한을 4MB 로 둬서 플랫폼이 먼저 끊는 상황을 피했습니다.

---

## 6. 검증

`./scripts/verify.sh` 는 **브라우저를 거치지 않고 API 를 직접** 호출합니다.
화면에서 막히는 것은 아무 의미가 없고, `curl` 로도 막혀야 진짜 강제이기 때문입니다.

<details>
<summary>실행 결과 (36 passed)</summary>

```
[1] 초기 상태 — 명세상 고정 확장자 기본값은 unCheck
  ✓ 차단 전이므로 .exe 통과                      201

[2] 고정 확장자 exe 를 차단으로 전환
  ✓ PATCH exe → isBlocked=true                   200

[3] 확장자 우회 시도 — 전부 차단되어야 한다
  ✓ 기본형          installer.exe                400 BLOCKED_EXTENSION
  ✓ 대문자          installer.EXE                400 BLOCKED_EXTENSION
  ✓ 혼합            installer.ExE                400 BLOCKED_EXTENSION
  ✓ 후행 점         installer.exe.               400 BLOCKED_EXTENSION
  ✓ 후행 공백       'installer.exe '             400 BLOCKED_EXTENSION
  ✓ 이중 확장자     resume.exe.pdf               400 BLOCKED_EXTENSION
  ✓ 이중 확장자     resume.pdf.exe               400 BLOCKED_EXTENSION
  ✓ 연속 점         installer..exe               400 BLOCKED_EXTENSION
  ✓ 전각 문자       installer.ｅｘｅ              400 BLOCKED_EXTENSION

[4] 파일명 자체가 비정상 — 확장자 정책 이전 단계에서 차단
  ✓ 경로 순회       ../../etc/passwd             400 ILLEGAL_PATH_SEPARATOR
  ✓ 윈도우 경로     C:\evil.exe                  400 ILLEGAL_PATH_SEPARATOR
  ✓ RTLO 위장       photo_<U+202E>gnp.exe        400 ILLEGAL_BIDI_CHAR

[5] 내용 기반 차단 — 확장자만으로는 절대 못 잡는 영역
  ✓ 이름만 바꾼 exe → photo.png                  400 EXECUTABLE_SIGNATURE
  ✓ shebang 스크립트 → memo.txt                  400 EXECUTABLE_SIGNATURE
  ✓ 확장자 없는 실행 파일                        400 EXECUTABLE_SIGNATURE

[6] 정상 파일은 통과
  ✓ 일반 텍스트     memo.txt                     201
  ✓ 정상 PDF        report.pdf                   201

[7] 커스텀 확장자 — 입력 검증과 중복 방지
  ✓ sh 추가                                      201
  ✓ SH 재추가 → 중복                             409
  ✓ .sh 재추가 → 중복                            409
  ✓ ' sh ' 재추가 → 중복                         409
  ✓ exe(고정) 추가 → 중복                        409
  ✓ 20자 → 허용                                  201
  ✓ 21자 → 거부                                  400
  ✓ 빈 문자열 → 거부                             400
  ✓ 경로 문자 → 거부                             400
  ✓ 한글 → 거부                                  400
  ✓ 숫자 타입 → 거부                             400
  ✓ tar.gz(중간 점) → 거부                       400

[8] 커스텀 정책이 업로드에 즉시 반영된다
  ✓ script.sh 차단                               400 BLOCKED_EXTENSION
  ✓ script.SH 도 차단                            400 BLOCKED_EXTENSION

[9] 고정 확장자는 DELETE 로 삭제되지 않는다
  ✓ DELETE 고정 exe → 404                        404

[10] 정책 해제 후 다시 허용되는지
  ✓ PATCH exe → isBlocked=false                  200
  ✓ 해제 후 installer.exe 통과                   201

결과: 36 passed
```

</details>

동시성은 별도로 검증합니다 — 코드를 읽어서는 알 수 없고, 실제로 동시에 때려봐야 알기 때문입니다.

```
✓ 같은 확장자를 20번 동시에 추가해도 정확히 1개만 저장된다
✓ 199개 상태에서 10개가 동시에 달려들어도 정확히 200개에서 멈춘다
✓ 고정 확장자와 같은 값은 커스텀으로 추가되지 않는다
```

---

## 7. 프로젝트 구조

```
docs/schema.sql              ← 테이블 스키마 (단일 출처, 그대로 실행됨)
scripts/
  migrate.ts                 ← schema.sql 실행
  verify.sh                  ← API 직접 호출 검증 (36 시나리오)
src/
  lib/
    config.ts                ← 정책 상수 (= 과제 명세가 코드로 모인 곳)
    db.ts                    ← 커넥션 풀, 트랜잭션 헬퍼
    extension/
      normalize.ts           ★ 정규화·확장자 추출 (순수 함수, 이 과제의 심장)
      repository.ts          ← 정책 CRUD (동시성 방어 포함)
      policy.ts              ← 차단 집합 조회 (캐시)
      policy-cache.ts        ← 캐시 상태 (순환 참조 회피용 분리)
    upload/
      signature.ts           ★ 매직넘버 판별
      validate.ts            ★ 검증 오케스트레이션 (유일한 강제 지점)
      storage.ts             ← UUID 저장, 웹루트 밖, 0600
      repository.ts          ← 업로드 기록
  app/
    page.tsx                 ← [화면] 파일 업로드 (메인). 차단 개수만 조회
    settings/page.tsx        ← [화면] 차단 정책 설정. 업로드 화면의 버튼으로 진입
    api/extensions/          ← 정책 CRUD
    api/upload/              ← 업로드
  components/
    UploadPanel.tsx          ← 드롭존 + 업로드 + 최근 기록 (클라이언트)
    PolicyEditor.tsx         ← 고정/커스텀 정책 편집 (낙관적 업데이트 + 롤백)
tests/
  normalize.test.ts          ← 56개 — 정규화 규칙 명세서 역할
  signature.test.ts          ← 14개
  validate.test.ts           ← 24개 — 우회 시나리오
  concurrency.integration.test.ts ← 6개 — 실제 DB 필요
```

---

## 8. 테이블 스키마 요약

전문은 [`docs/schema.sql`](./docs/schema.sql)에 있습니다. 핵심만 옮기면:

```sql
CREATE TABLE blocked_extension (
    id          BIGSERIAL    PRIMARY KEY,
    extension   VARCHAR(20)  NOT NULL,   -- 정규화된 소문자, 선행 '.' 없음
    type        VARCHAR(10)  NOT NULL,   -- 'FIXED' | 'CUSTOM'
    is_blocked  BOOLEAN      NOT NULL DEFAULT FALSE,  -- 명세: 기본 unCheck
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT uq_blocked_extension_ext    UNIQUE (extension),
    CONSTRAINT ck_blocked_extension_type   CHECK (type IN ('FIXED','CUSTOM')),
    CONSTRAINT ck_blocked_extension_format CHECK (extension ~ '^[a-z0-9]{1,20}$')
);

CREATE INDEX ix_blocked_extension_active
    ON blocked_extension (extension) WHERE is_blocked = TRUE;
```

부가 테이블 2개: `extension_policy_audit`(정책 변경 이력), `upload_record`(업로드 시도 기록).

설계 근거는 `CONSIDERATIONS.md` §4 를 참고하세요.
