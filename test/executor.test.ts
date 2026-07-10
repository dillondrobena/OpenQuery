import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { PgliteExecutor } from '../src/executor/pglite.js';
import { PgExecutor } from '../src/executor/pg.js';
import { acquireLock, LockTimeoutError } from '../src/executor/lockfile.js';
import type { Executor } from '../src/executor/types.js';

/*
 * Parity suite: the same behavioral assertions run against every backend.
 * PGlite always; PgExecutor when TEST_PG_URL points at a disposable Postgres
 * (CI provides a service container).
 */

async function seeded(executor: PgliteExecutor): Promise<PgliteExecutor> {
  await executor.execRaw(readFileSync('demo/schema.sql', 'utf8'));
  await executor.execRaw(readFileSync('demo/seed.sql', 'utf8'));
  return executor;
}

function paritySuite(name: string, make: () => Promise<Executor>, teardown: (e: Executor) => Promise<void>) {
  describe(`executor parity: ${name}`, () => {
    let executor: Executor;

    it('setup', async () => {
      executor = await make();
    });

    afterAll(async () => {
      if (executor) await teardown(executor);
    });

    it('numeric, int8, count() and dates are strings — never floats or Dates', async () => {
      const outcome = await executor.query(
        `SELECT t.id, t.amount, t.created_at, count(*) OVER () AS total
         FROM transactions t WHERE t.company_id = $1 ORDER BY t.created_at DESC`,
        { params: [2] }
      );
      const row = outcome.rows[0]!;
      expect(typeof row.id).toBe('string');
      expect(row.amount).toBe('4200.00');
      expect(typeof row.created_at).toBe('string');
      expect((row.created_at as string).startsWith('2026-06-30')).toBe(true);
      // 5 = Dana's 4 Globex txns + Sam's noise txn 7002 (query filters by company only)
      expect(row.total).toBe('5');
    });

    it('reports rowCount, columns, durationMs', async () => {
      const outcome = await executor.query('SELECT id, name FROM companies ORDER BY id');
      expect(outcome.rowCount).toBe(4);
      expect(outcome.truncated).toBe(false);
      expect(outcome.columns).toEqual(['id', 'name']);
      expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('row cap truncates and reports it', async () => {
      const outcome = await executor.query('SELECT id FROM transactions ORDER BY id', { maxRows: 2 });
      expect(outcome.rows.length).toBe(2);
      expect(outcome.truncated).toBe(true);
    });

    it('zero rows is success, not an error', async () => {
      const outcome = await executor.query('SELECT id FROM users WHERE id = $1', { params: [999999] });
      expect(outcome.rowCount).toBe(0);
      expect(outcome.truncated).toBe(false);
    });

    it('read-only transaction blocks writes even if the guard were bypassed', async () => {
      await expect(
        executor.query("INSERT INTO companies (id, name) VALUES (99, 'Evil Inc')")
      ).rejects.toThrow(/read-only/i);
    });
  });
}

paritySuite(
  'PGlite (in-memory)',
  async () => seeded(new PgliteExecutor()),
  async (e) => e.close()
);

const pgUrl = process.env.TEST_PG_URL;
if (pgUrl) {
  paritySuite(
    'node-postgres',
    async () => {
      const setup = new PgExecutor(pgUrl);
      // Assumes an empty disposable database; CI recreates it per run.
      const raw = new (await import('pg')).default.Client({ connectionString: pgUrl });
      await raw.connect();
      await raw.query(readFileSync('demo/schema.sql', 'utf8'));
      await raw.query(readFileSync('demo/seed.sql', 'utf8'));
      await raw.end();
      return setup;
    },
    async (e) => e.close()
  );
} else {
  it.skip('node-postgres parity (set TEST_PG_URL to enable)', () => {});
}

describe('lockfile', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oq-lock-'));
  const lockPath = path.join(dir, 'demo.lock');

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('acquires and releases', async () => {
    const release = await acquireLock(lockPath, 1000);
    await expect(fs.readFile(lockPath, 'utf8')).resolves.toBe(String(process.pid));
    await release();
    await expect(fs.access(lockPath)).rejects.toThrow();
  });

  it('reclaims a stale lock held by a dead PID', async () => {
    await fs.writeFile(lockPath, '999999999', 'utf8'); // almost certainly dead
    const release = await acquireLock(lockPath, 2000);
    await expect(fs.readFile(lockPath, 'utf8')).resolves.toBe(String(process.pid));
    await release();
  });

  it('times out with a clear error when the lock is held by a live process', async () => {
    const release = await acquireLock(lockPath, 1000);
    await expect(acquireLock(lockPath, 400)).rejects.toThrow(LockTimeoutError);
    await release();
  });

  it('waits and succeeds when the lock is released during the wait', async () => {
    const release = await acquireLock(lockPath, 1000);
    const pending = acquireLock(lockPath, 3000);
    setTimeout(() => void release(), 250);
    const release2 = await pending;
    await release2();
  });
});
