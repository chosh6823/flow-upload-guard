/**
 * docs/schema.sql 을 그대로 실행한다.
 *
 * ORM 마이그레이션 도구를 쓰지 않는 이유:
 *   과제 제출물에 "table schema" 를 포함해야 하는데, ORM 을 쓰면
 *   문서에 적은 DDL 과 실제로 실행되는 DDL 이 갈라질 수 있다.
 *   SQL 파일 하나를 단일 출처로 삼고 그것을 그대로 실행하면 그 위험이 없다.
 *
 * schema.sql 의 모든 문장은 IDEMPOTENT 하므로 몇 번을 돌려도 안전하다.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error(
      'DATABASE_URL 이 없습니다. .env.example 을 복사해 .env 를 만들어 주세요.'
    );
    process.exit(1);
  }

  const sqlPath = path.resolve(process.cwd(), 'docs/schema.sql');
  const sql = await readFile(sqlPath, 'utf8');

  const client = new Client({
    connectionString,
    ssl:
      connectionString.includes('sslmode=disable') || process.env.PGSSL === 'off'
        ? undefined
        : { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    // 전체를 한 트랜잭션으로 감싼다. 중간에 실패하면 아무것도 적용되지 않는다.
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log(`적용 완료: ${sqlPath}`);

    const { rows } = await client.query<{ type: string; count: string }>(
      `SELECT type, count(*)::text AS count FROM blocked_extension GROUP BY type ORDER BY type`
    );
    for (const row of rows) {
      console.log(`  ${row.type}: ${row.count}개`);
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('마이그레이션 실패:', error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void main();
