import { Pool } from 'pg';

/**
 * Postgres 커넥션 풀.
 *
 * Next.js 개발 서버는 HMR 마다 모듈을 다시 평가한다. 그대로 두면 리로드할 때마다
 * 새 풀이 생겨 커넥션이 누수되고, 몇 번 저장하면 "too many clients" 로 죽는다.
 * globalThis 에 붙여 프로세스당 하나만 유지한다.
 *
 * 서버리스(Vercel) 배포 시 주의:
 *   함수 인스턴스마다 풀이 생기므로 max 를 작게 잡아야 한다.
 *   Neon/Supabase 를 쓴다면 반드시 **pooler 엔드포인트**(-pooler / :6543)를 쓸 것.
 *   직결 엔드포인트로는 인스턴스가 조금만 늘어도 커넥션 상한에 부딪힌다.
 */

declare global {
  // eslint-disable-next-line no-var
  var __uploadGuardPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL 이 설정되지 않았습니다. .env.example 을 참고해 .env 를 만들어 주세요.'
    );
  }

  return new Pool({
    connectionString,
    // 서버리스 환경을 가정한 보수적인 값.
    max: Number(process.env.PGPOOL_MAX ?? 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // 관리형 Postgres(Neon/Supabase/Railway)는 대부분 TLS 를 요구하지만
    // 사설 CA 를 쓰는 경우가 많아 체인 검증까지는 걸지 않는다.
    ssl: connectionString.includes('sslmode=disable')
      ? undefined
      : process.env.PGSSL === 'off'
        ? undefined
        : { rejectUnauthorized: false },
  });
}

export const pool: Pool = globalThis.__uploadGuardPool ?? createPool();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__uploadGuardPool = pool;
}

/**
 * 트랜잭션 헬퍼.
 * 콜백이 던지면 롤백하고 예외를 그대로 올린다. 커넥션 반납은 항상 보장된다.
 */
export async function withTransaction<T>(
  fn: (client: import('pg').PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {
      /* 롤백 실패는 원래 에러를 가리지 않도록 삼킨다 */
    });
    throw error;
  } finally {
    client.release();
  }
}

/** Postgres UNIQUE 제약 위반 여부 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

/** Postgres CHECK 제약 위반 여부 */
export function isCheckViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23514'
  );
}
