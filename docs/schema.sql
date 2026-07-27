-- ===========================================================================
--  flow-upload-guard : table schema
--  PostgreSQL 14+
--
--  이 파일이 스키마의 단일 출처(single source of truth)다.
--  `npm run db:migrate` 가 이 파일을 그대로 실행한다 (scripts/migrate.ts).
--  ORM 이 생성한 DDL 과 문서상의 DDL 이 어긋나는 사고를 원천 차단하기 위해
--  ORM 을 쓰지 않고 이 SQL 을 직접 실행한다. 근거는 CONSIDERATIONS.md §4.
--
--  모든 문장은 IDEMPOTENT 하다 (재실행 안전).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. blocked_extension : 확장자 차단 정책
--
--   고정(FIXED) / 커스텀(CUSTOM) 확장자를 한 테이블에 둔다.
--   업로드 검증은 "지금 차단 중인 확장자 집합"만 알면 되므로,
--   테이블을 나누면 매 업로드마다 UNION 조회 + 두 테이블 교차 중복검사가 필요해진다.
--   type 컬럼 하나로 UI 표시 영역과 삭제 가능 여부만 갈린다.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blocked_extension (
    id          BIGSERIAL    PRIMARY KEY,

    -- 정규화된 확장자: 항상 소문자, 선행 '.' 없음, 공백 없음.
    -- 정규화 규칙의 구현 출처는 src/lib/extension/normalize.ts 의 normalizeExtension().
    extension   VARCHAR(20)  NOT NULL,

    -- 'FIXED'  : 명세상 고정 7종. 행이 삭제되지 않고 is_blocked 만 토글된다.
    -- 'CUSTOM' : 사용자가 추가. 삭제 시 행이 제거된다.
    -- native ENUM 대신 VARCHAR + CHECK 를 쓴 이유:
    --   값 추가/변경이 ALTER TYPE 없이 가능하고, 덤프/이관이 단순하다.
    type        VARCHAR(10)  NOT NULL,

    -- 실제 차단 여부.
    -- 명세 "고정 확장자 default 는 unCheck" 를 그대로 반영해 기본값 FALSE.
    -- 커스텀은 추가 시점에 항상 TRUE 로 들어온다(차단하려고 추가하는 것이므로).
    is_blocked  BOOLEAN      NOT NULL DEFAULT FALSE,

    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- [핵심] 중복 추가 방지의 최종 방어선.
    -- 애플리케이션의 "SELECT 로 있나 보고 없으면 INSERT" 는 동시 요청에서 반드시 뚫린다.
    -- 서버 코드는 이 제약 위반(SQLSTATE 23505)을 잡아 409 로 변환할 뿐이다.
    CONSTRAINT uq_blocked_extension_ext
        UNIQUE (extension),

    CONSTRAINT ck_blocked_extension_type
        CHECK (type IN ('FIXED', 'CUSTOM')),

    -- [핵심] 길이 20자 제한과 문자 집합 제한을 DB 에서도 강제한다.
    --   1차: 브라우저 maxLength (UX)
    --   2차: 서버 검증      (강제)
    --   3차: 이 CHECK        (최후의 보루 — 다른 경로로 INSERT 되더라도 막힌다)
    -- 확장자에 '.', '/', 공백, 제어문자, 한글이 섞이는 것을 여기서 차단한다.
    CONSTRAINT ck_blocked_extension_format
        CHECK (extension ~ '^[a-z0-9]{1,20}$')
);

-- 업로드 검증 쿼리는 항상 `WHERE is_blocked = TRUE` 만 본다.
-- 부분 인덱스로 차단 중인 행만 색인한다 (해제된 정책은 인덱스에 없음).
-- 최대 207행 규모라 실측 이득은 미미하지만, 정책 테이블이 커져도 계획이 바뀌지 않는다.
CREATE INDEX IF NOT EXISTS ix_blocked_extension_active
    ON blocked_extension (extension)
    WHERE is_blocked = TRUE;

-- 커스텀 목록 조회(추가 순 정렬)와 200개 카운트용.
CREATE INDEX IF NOT EXISTS ix_blocked_extension_type_created
    ON blocked_extension (type, created_at);


-- ---------------------------------------------------------------------------
-- 2. extension_policy_audit : 정책 변경 감사 로그
--
--   커스텀 확장자를 hard delete 하기 때문에, "언제 무엇이 지워졌는가"는
--   이 테이블에만 남는다. 보안 정책에서 변경 이력은 정책 자체만큼 중요하다.
--   (soft delete 를 쓰지 않은 이유는 CONSIDERATIONS.md §3-4 참고)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS extension_policy_audit (
    id          BIGSERIAL    PRIMARY KEY,
    extension   VARCHAR(20)  NOT NULL,

    -- ADD | REMOVE | BLOCK | UNBLOCK
    action      VARCHAR(16)  NOT NULL,

    -- 인증은 과제 범위 밖이라 현재 전부 'anonymous'.
    -- 컬럼을 미리 확보해 두어 인증 도입 시 스키마 변경 없이 채울 수 있게 한다.
    actor       VARCHAR(64)  NOT NULL DEFAULT 'anonymous',

    changed_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT ck_policy_audit_action
        CHECK (action IN ('ADD', 'REMOVE', 'BLOCK', 'UNBLOCK'))
);

CREATE INDEX IF NOT EXISTS ix_policy_audit_changed_at
    ON extension_policy_audit (changed_at DESC);


-- ---------------------------------------------------------------------------
-- 3. upload_record : 업로드 시도 기록 (성공 + 차단 모두)
--
--   차단된 시도야말로 남길 가치가 있다. 같은 IP 에서
--   `a.exe` → `a.EXE` → `a.exe.png` → `a.exe%00.png` 순으로 시도가 들어오면
--   그건 우회 공격이고, 이 테이블이 그걸 탐지할 유일한 신호다.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS upload_record (
    id                BIGSERIAL    PRIMARY KEY,

    -- 클라이언트가 보낸 원본 파일명. 신뢰할 수 없는 입력이므로
    -- 표시/로깅 용도로만 쓰고 저장 경로 조립에는 절대 쓰지 않는다.
    original_name     VARCHAR(255) NOT NULL,

    -- 서버가 부여한 저장 파일명(UUID). 차단된 경우 NULL.
    stored_name       VARCHAR(64),

    size_bytes        BIGINT       NOT NULL,

    -- ACCEPTED | REJECTED
    status            VARCHAR(16)  NOT NULL,

    -- 차단 사유 코드. 사람이 읽는 메시지가 아니라 집계 가능한 코드로 남긴다.
    reject_reason     VARCHAR(64),

    -- 실제로 차단을 유발한 확장자 (a.exe.pdf 라면 'exe')
    matched_extension VARCHAR(20),

    -- 매직넘버로 판별한 실제 파일 종류.
    -- 클라이언트가 보낸 Content-Type 이 아니라 서버가 바이트를 읽어 판별한 값이다.
    sniffed_type      VARCHAR(32),

    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT ck_upload_record_status
        CHECK (status IN ('ACCEPTED', 'REJECTED')),

    -- 차단되었으면 사유가 반드시 있어야 하고, 통과했으면 저장명이 반드시 있어야 한다.
    -- (STORAGE_DRIVER=none 인 서버리스 데모 환경에서는 stored_name 에 'discarded' 를 넣는다)
    CONSTRAINT ck_upload_record_reason
        CHECK (
            (status = 'REJECTED' AND reject_reason IS NOT NULL)
         OR (status = 'ACCEPTED' AND reject_reason IS NULL)
        )
);

CREATE INDEX IF NOT EXISTS ix_upload_record_created_at
    ON upload_record (created_at DESC);

CREATE INDEX IF NOT EXISTS ix_upload_record_status
    ON upload_record (status);


-- ---------------------------------------------------------------------------
-- 4. seed : 고정 확장자 7종
--
--   명세: bat, cmd, com, cpl, exe, scr, js / default 는 unCheck
--   ON CONFLICT DO NOTHING 이므로 재실행해도 사용자의 체크 상태를 덮어쓰지 않는다.
--   (초기값 주입과 상태 보존을 동시에 만족시키는 부분이다)
-- ---------------------------------------------------------------------------
INSERT INTO blocked_extension (extension, type, is_blocked) VALUES
    ('bat', 'FIXED', FALSE),
    ('cmd', 'FIXED', FALSE),
    ('com', 'FIXED', FALSE),
    ('cpl', 'FIXED', FALSE),
    ('exe', 'FIXED', FALSE),
    ('scr', 'FIXED', FALSE),
    ('js',  'FIXED', FALSE)
ON CONFLICT (extension) DO NOTHING;
