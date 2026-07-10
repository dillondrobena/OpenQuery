import pg from 'pg';
import Cursor from 'pg-cursor';
import {
  DEFAULT_MAX_ROWS,
  DEFAULT_TIMEOUT_MS,
  type Executor,
  type QueryOptions,
  type QueryOutcome,
} from './types.js';

// Exact-precision values: dates/timestamps stay strings (int8 and numeric
// already arrive as strings from node-postgres). Never JS Dates or floats.
pg.types.setTypeParser(1082, (v: string) => v);
pg.types.setTypeParser(1114, (v: string) => v);
pg.types.setTypeParser(1184, (v: string) => v);

export class PgExecutor implements Executor {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 2 });
  }

  /** Cheap connectivity probe used by `connect`. */
  async ping(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
  }

  /** Best-effort role write-grant check (labeled best-effort in all output). */
  async roleHasWriteGrants(): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT count(*)::int AS n FROM information_schema.role_table_grants
         WHERE grantee = current_user
           AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')`
      );
      return (result.rows[0]?.n ?? 0) > 0;
    } finally {
      client.release();
    }
  }

  async query(sql: string, opts: QueryOptions = {}): Promise<QueryOutcome> {
    const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const started = Date.now();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN TRANSACTION READ ONLY');
      await client.query(`SET LOCAL statement_timeout = ${Math.floor(timeoutMs)}`);

      // Cursor-based row cap: stop reading past maxRows — no SQL rewriting.
      const cursor = client.query(new Cursor(sql, (opts.params ?? []) as unknown[]));
      const rows = (await cursor.read(maxRows + 1)) as Array<Record<string, unknown>>;
      const truncated = rows.length > maxRows;
      if (truncated) rows.length = maxRows;
      const columns = rows.length > 0 ? Object.keys(rows[0] as object) : [];
      await cursor.close();
      await client.query('COMMIT');
      return { rows, rowCount: rows.length, truncated, columns, durationMs: Date.now() - started };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
