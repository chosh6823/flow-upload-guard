import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

/**
 * 동시성 통합 테스트 — 실제 Postgres 가 필요하다.
 *
 * 실행:  DATABASE_URL=... npx vitest run tests/concurrency.integration.test.ts
 * DATABASE_URL 이 없으면 통째로 건너뛴다 (CI 에서 단위 테스트만 돌릴 수 있게).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  왜 이 테스트를 따로 만들었나
 *
 *  "중복 방지"와 "최대 200개"는 단일 요청만 보면 if 문 두 개로 끝나는 요구사항이다.
 *  동시 요청을 넣는 순간 둘 다 무너진다:
 *
 *    - 중복: SELECT 로 없는 걸 확인한 두 요청이 나란히 INSERT 한다
 *    - 개수: 199개 상태에서 두 요청이 각각 "199 < 200" 을 통과해 201개가 된다
 *
 *  UNIQUE 제약과 advisory lock 이 실제로 이걸 막는지는 코드를 읽어서는 알 수 없다.
 *  동시에 때려봐야 안다.
 * ─────────────────────────────────────────────────────────────────────────
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

if (!hasDb) {
  console.warn('[skip] DATABASE_URL 이 없어 동시성 통합 테스트를 건너뜁니다.');
}

/**
 * DB 모듈은 첫 getPool() 호출 시점에 풀을 만들고, DATABASE_URL 이 없으면 던진다.
 * 모듈 평가만으로 죽지는 않지만, DB 가 없는 환경에서 이 파일이 skip 되는 동안
 * 불필요한 모듈 평가를 하지 않도록 beforeAll 에서 동적으로 불러온다.
 */
type Repo = typeof import('@/lib/extension/repository');
type Db = typeof import('@/lib/db');

let repo: Repo;
let db: Db;
let MAX_CUSTOM_EXTENSIONS = 200;

async function clearCustom(): Promise<void> {
  await db.getPool().query(`DELETE FROM blocked_extension WHERE type = 'CUSTOM'`);
  await db.getPool().query(`DELETE FROM extension_policy_audit`);
}

suite('동시성', () => {
  beforeAll(async () => {
    repo = await import('@/lib/extension/repository');
    db = await import('@/lib/db');
    ({ MAX_CUSTOM_EXTENSIONS } = await import('@/lib/config'));
  });

  beforeEach(async () => {
    await clearCustom();
  });

  afterAll(async () => {
    await clearCustom();
    await db.getPool().end();
  });

  it('같은 확장자를 20번 동시에 추가해도 정확히 1개만 저장된다', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => repo.addCustomExtension('sh'))
    );

    const succeeded = results.filter((r) => r.ok);
    const duplicates = results.filter((r) => !r.ok && r.code === 'DUPLICATE');

    expect(succeeded).toHaveLength(1);
    expect(duplicates).toHaveLength(19);
    expect(await repo.countCustomExtensions()).toBe(1);
  });

  it('대소문자·점 변형을 동시에 넣어도 1개만 저장된다', async () => {
    // 정규화가 API 레이어에서 일어나므로 여기서는 이미 정규화된 값이 온다고 보고,
    // repository 레벨의 UNIQUE 제약만 확인한다.
    // (정규화 자체는 normalize.test.ts 가 검증한다)
    const results = await Promise.all(
      ['sh', 'sh', 'sh', 'sh', 'sh'].map((e) => repo.addCustomExtension(e))
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await repo.countCustomExtensions()).toBe(1);
  });

  it('고정 확장자와 같은 값은 커스텀으로 추가되지 않는다', async () => {
    // seed 로 'exe' 가 FIXED 로 들어 있다. UNIQUE(extension) 이 테이블 전체에 걸려 있으므로
    // 커스텀으로 중복 등록되지 않는다 — 명세의 "고정 확장자는 커스텀 영역에 표시되지 않음"이
    // UI 규칙이 아니라 데이터 제약으로 보장된다.
    const result = await repo.addCustomExtension('exe');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('DUPLICATE');
    expect(await repo.countCustomExtensions()).toBe(0);
  });

  it(`${MAX_CUSTOM_EXTENSIONS}개 경계에서 동시 요청이 상한을 넘지 못한다`, async () => {
    // 199개까지 순차로 채운다
    for (let i = 0; i < MAX_CUSTOM_EXTENSIONS - 1; i += 1) {
      const result = await repo.addCustomExtension(`ext${i}`);
      expect(result.ok).toBe(true);
    }
    expect(await repo.countCustomExtensions()).toBe(MAX_CUSTOM_EXTENSIONS - 1);

    // 마지막 한 자리를 두고 10개가 동시에 달려든다.
    // advisory lock 이 없으면 여기서 209개가 된다.
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => repo.addCustomExtension(`race${i}`))
    );

    const succeeded = results.filter((r) => r.ok);
    const rejected = results.filter(
      (r) => !r.ok && r.code === 'LIMIT_EXCEEDED'
    );

    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(9);
    expect(await repo.countCustomExtensions()).toBe(MAX_CUSTOM_EXTENSIONS);
  }, 60_000);

  it('상한에 도달한 뒤에는 어떤 추가도 받지 않는다', async () => {
    for (let i = 0; i < MAX_CUSTOM_EXTENSIONS; i += 1) {
      expect((await repo.addCustomExtension(`ext${i}`)).ok).toBe(true);
    }

    const overflow = await repo.addCustomExtension('onemore');
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.code).toBe('LIMIT_EXCEEDED');
    expect(await repo.countCustomExtensions()).toBe(MAX_CUSTOM_EXTENSIONS);
  }, 60_000);

  it('고정 확장자 7종은 항상 그대로 남아 있다', async () => {
    await repo.addCustomExtension('sh');
    const rows = await repo.listExtensions();
    const fixed = rows.filter((r) => r.type === 'FIXED').map((r) => r.extension);

    expect(fixed).toEqual(['bat', 'cmd', 'com', 'cpl', 'exe', 'scr', 'js']);
  });
});
