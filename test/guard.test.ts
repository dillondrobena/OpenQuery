import { describe, expect, it } from 'vitest';
import { validateSql } from '../src/safety/guard.js';

/*
 * Table-driven guard matrix. Every allow and every reject here is a claim the
 * README makes. A new mutation vector => a new row, never a code special-case.
 */

const ALLOWED: Array<[name: string, sql: string]> = [
  ['simple SELECT', 'SELECT 1'],
  ['flagship join', `SELECT t.id, t.amount FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     JOIN companies c ON c.id = t.company_id
     WHERE a.user_id = $1 AND c.name = $2`],
  ['read-only WITH', 'WITH recent AS (SELECT * FROM transactions WHERE created_at > $1) SELECT count(*) FROM recent'],
  ['nested read-only CTEs', 'WITH a AS (SELECT 1 AS x), b AS (SELECT x FROM a) SELECT * FROM b'],
  ['UNION', 'SELECT id FROM users UNION SELECT id FROM companies'],
  ['subquery + LATERAL', `SELECT u.id, tx.total FROM users u,
     LATERAL (SELECT sum(amount) AS total FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.user_id = u.id) tx`],
  ['window function', 'SELECT id, sum(amount) OVER (PARTITION BY company_id ORDER BY created_at) FROM transactions'],
  ['GROUPING SETS', 'SELECT company_id, account_id, sum(amount) FROM transactions GROUP BY GROUPING SETS ((company_id), (account_id), ())'],
  ['ANY(array param)', 'SELECT * FROM companies WHERE name = ANY($1)'],
  ['plain EXPLAIN', 'EXPLAIN SELECT * FROM transactions WHERE account_id = $1'],
  ['EXPLAIN (FORMAT JSON)', 'EXPLAIN (FORMAT JSON) SELECT id FROM users'],
  ['VALUES via SELECT', 'SELECT * FROM (VALUES (1, 2), (3, 4)) AS v(a, b)'],
];

const REJECTED: Array<[name: string, sql: string, code?: 'PARSE_ERROR']> = [
  ['UPDATE', "UPDATE users SET name = 'x' WHERE id = 1"],
  ['DELETE', 'DELETE FROM transactions'],
  ['INSERT', "INSERT INTO users (id, name, email) VALUES (99, 'x', 'x@x')"],
  ['MERGE', 'MERGE INTO users u USING companies c ON u.id = c.id WHEN MATCHED THEN DO NOTHING'],
  ['DROP TABLE', 'DROP TABLE users'],
  ['CREATE TABLE', 'CREATE TABLE evil (id int)'],
  ['ALTER TABLE', 'ALTER TABLE users ADD COLUMN hacked int'],
  ['TRUNCATE', 'TRUNCATE transactions'],
  ['GRANT', 'GRANT ALL ON users TO PUBLIC'],
  ['CTE-embedded DELETE', 'WITH d AS (DELETE FROM transactions RETURNING *) SELECT count(*) FROM d'],
  ['CTE-embedded INSERT', "WITH i AS (INSERT INTO users (id, name, email) VALUES (99,'x','y') RETURNING id) SELECT * FROM i"],
  ['CTE-embedded UPDATE deep', "WITH a AS (SELECT 1), b AS (UPDATE users SET name='x' RETURNING id) SELECT * FROM b"],
  ['multi-statement select', 'SELECT 1; SELECT 2'],
  ['multi-statement attack', 'SELECT 1; DROP TABLE users'],
  ['SET', "SET default_transaction_read_only = off"],
  ['RESET', 'RESET ALL'],
  ['BEGIN', 'BEGIN'],
  ['COMMIT', 'COMMIT'],
  ['ROLLBACK', 'ROLLBACK'],
  ['DO block', "DO $$ BEGIN PERFORM 1; END $$"],
  ['COPY', "COPY users TO '/tmp/out.csv'"],
  ['CALL', 'CALL some_procedure()'],
  ['EXPLAIN ANALYZE', 'EXPLAIN ANALYZE SELECT * FROM users'],
  ['EXPLAIN (ANALYZE true)', 'EXPLAIN (ANALYZE true) SELECT 1'],
  ['EXPLAIN UPDATE', "EXPLAIN UPDATE users SET name = 'x'"],
  ['SELECT FOR UPDATE', 'SELECT * FROM users WHERE id = 1 FOR UPDATE'],
  ['SELECT FOR SHARE', 'SELECT * FROM users FOR SHARE'],
  ['SELECT INTO', 'SELECT * INTO stolen FROM users'],
  ['garbage', 'SELEC broken syntax here', 'PARSE_ERROR'],
  ['empty string', '', 'PARSE_ERROR'],
];

describe('guard: allowed statements', () => {
  it.each(ALLOWED)('%s', async (_name, sql) => {
    const result = await validateSql(sql);
    expect(result).toMatchObject({ ok: true });
  });
});

describe('guard: rejected statements', () => {
  it.each(REJECTED)('%s', async (_name, sql, code) => {
    const result = await validateSql(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(code ?? 'GUARD_REJECTED');
      expect(result.hint.length).toBeGreaterThan(10);
    }
  });
});

describe('guard: joinPath extraction (computed, not asserted)', () => {
  it('flagship query: tables in order of appearance', async () => {
    const result = await validateSql(
      `SELECT t.id FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       JOIN companies c ON c.id = t.company_id
       WHERE a.user_id = $1`
    );
    expect(result).toEqual({ ok: true, joinPath: ['transactions', 'accounts', 'companies'] });
  });

  it('dedupes repeated tables (self-join counts once)', async () => {
    const result = await validateSql(
      'SELECT a.id FROM accounts a JOIN accounts b ON a.user_id = b.user_id'
    );
    expect(result).toEqual({ ok: true, joinPath: ['accounts'] });
  });

  it('includes schema qualification', async () => {
    const result = await validateSql('SELECT * FROM billing.invoices i JOIN users u ON u.id = i.user_id');
    expect(result).toEqual({ ok: true, joinPath: ['billing.invoices', 'users'] });
  });

  it('sees through CTEs and subqueries', async () => {
    const result = await validateSql(
      'WITH recent AS (SELECT * FROM transactions) SELECT * FROM recent r JOIN companies c ON c.id = r.company_id'
    );
    expect(result).toEqual({ ok: true, joinPath: ['transactions', 'recent', 'companies'] });
  });
});
