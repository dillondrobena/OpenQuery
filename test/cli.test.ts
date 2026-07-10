import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/*
 * End-to-end CLI tests: real process spawns against an isolated
 * OPENQUERY_HOME with the seeded PGlite demo database.
 */

const HOME = mkdtempSync(path.join(tmpdir(), 'oq-home-'));

function cli(args: string[], input?: string) {
  const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/cli/index.ts', ...args], {
    env: { ...process.env, OPENQUERY_HOME: HOME },
    encoding: 'utf8',
    input,
    timeout: 120_000,
  });
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function stderrJson(stderr: string): { error: { code: string; message: string; hint?: string } } {
  const line = stderr.split('\n').find((l) => l.trim().startsWith('{'));
  expect(line, `expected JSON error on stderr, got: ${stderr}`).toBeDefined();
  return JSON.parse(line!) as { error: { code: string; message: string; hint?: string } };
}

beforeAll(() => {
  const result = cli(['demo', '--serve-db']);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('Alias registered: demo');
}, 180_000);

afterAll(() => rmSync(HOME, { recursive: true, force: true }));

describe('query command (E2E)', () => {
  it('runs a parameterized query and emits the envelope with computed joinPath', () => {
    const result = cli([
      'query', 'demo',
      '--sql', 'SELECT t.id, t.amount FROM transactions t JOIN accounts a ON a.id = t.account_id JOIN companies c ON c.id = t.company_id WHERE a.user_id = $1 AND c.name = $2 ORDER BY t.id',
      '--params', '[42, "Globex"]',
    ]);
    expect(result.code).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.notice).toMatch(/never instructions/);
    expect(envelope.receipt.joinPath).toEqual(['transactions', 'accounts', 'companies']);
    expect(envelope.receipt.params).toEqual([42, 'Globex']);
    expect(envelope.rowCount).toBe(4);
    expect(envelope.rows[0].amount).toBe('1600.00'); // string, ordered by id
  }, 120_000);

  it('rejects mutations with a GUARD_REJECTED JSON error and non-zero exit', () => {
    const result = cli(['query', 'demo', '--sql', 'DELETE FROM transactions']);
    expect(result.code).toBe(1);
    const err = stderrJson(result.stderr);
    expect(err.error.code).toBe('GUARD_REJECTED');
    expect(err.error.hint).toMatch(/read-only SELECT/);
  }, 120_000);

  it('rejects CTE-embedded DML', () => {
    const result = cli(['query', 'demo', '--sql', 'WITH d AS (DELETE FROM users RETURNING *) SELECT * FROM d']);
    expect(result.code).toBe(1);
    expect(stderrJson(result.stderr).error.code).toBe('GUARD_REJECTED');
  }, 120_000);

  it('unknown alias yields UNKNOWN_ALIAS with the connect handoff hint', () => {
    const result = cli(['query', 'nope', '--sql', 'SELECT 1']);
    expect(result.code).toBe(1);
    const err = stderrJson(result.stderr);
    expect(err.error.code).toBe('UNKNOWN_ALIAS');
    expect(err.error.hint).toMatch(/in their own terminal/);
  }, 120_000);

  it('rejects malformed --params with a helpful hint', () => {
    const result = cli(['query', 'demo', '--sql', 'SELECT 1', '--params', 'not-json']);
    expect(result.code).toBe(1);
    const err = stderrJson(result.stderr);
    expect(err.error.code).toBe('PARSE_ERROR');
    expect(err.error.hint).toMatch(/never interpolated/);
  }, 120_000);

  it('writes the audit log (sql + params, never rows)', () => {
    const audit = readFileSync(path.join(HOME, 'audit.jsonl'), 'utf8').trim().split('\n');
    const last = JSON.parse(audit[audit.length - 1]!);
    expect(last).toHaveProperty('sql');
    expect(last).toHaveProperty('params');
    expect(last).not.toHaveProperty('rows');
  });
});

describe('schema command (E2E)', () => {
  it('summary lists tables and foreign keys', () => {
    const result = cli(['schema', 'demo']);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    const names = parsed.tables.map((t: { table: string }) => t.table);
    expect(names).toEqual(expect.arrayContaining(['users', 'accounts', 'transactions', 'companies']));
    expect(parsed.foreignKeys.length).toBeGreaterThanOrEqual(3);
  }, 120_000);

  it('--table returns columns and primary key', () => {
    const result = cli(['schema', 'demo', '--table', 'transactions']);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.primaryKey).toEqual(['id']);
    const cols = parsed.columns.map((c: { column_name: string }) => c.column_name);
    expect(cols).toEqual(expect.arrayContaining(['id', 'account_id', 'company_id', 'amount', 'created_at']));
  }, 120_000);

  it('--filter scopes the summary', () => {
    const result = cli(['schema', 'demo', '--filter', 'tx*']);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).tables).toEqual([]);
  }, 120_000);
});

describe('connect command (E2E)', () => {
  it('refuses to run without an interactive TTY (agents cannot invoke it)', () => {
    const result = cli(['connect', 'mydb'], '');
    expect(result.code).toBe(1);
    const err = stderrJson(result.stderr);
    expect(err.error.code).toBe('CONNECT_FAILED');
    expect(err.error.message).toMatch(/interactive terminal/);
    expect(err.error.hint).toMatch(/Run this yourself/);
  }, 120_000);
});
