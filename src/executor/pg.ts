import pg from 'pg';
import Cursor from 'pg-cursor';
import { parse as parseConnectionString } from 'pg-connection-string';
import {
  DEFAULT_MAX_ROWS,
  DEFAULT_TIMEOUT_MS,
  type Executor,
  type QueryOptions,
  type QueryOutcome,
} from './types.js';

/*
 * SSL normalization. Connection strings carry ssl options as strings
 * (`?sslmode=require`, `?ssl=true`); node-postgres crashes internally
 * (`'key' in self.ssl`) when ssl reaches it as a non-object truthy value.
 * Map libpq-style modes to what pg actually accepts:
 *   disable/false            -> false        (no TLS)
 *   verify-ca/verify-full    -> {}           (TLS, verify certificate)
 *   require/prefer/true/...  -> { rejectUnauthorized: false }  (TLS, no verify
 *                               — matches libpq `require` semantics)
 * Object values pass through untouched (the user knew what they were doing).
 */
export function normalizeSsl(
  ssl: unknown
): false | Record<string, unknown> {
  if (ssl === undefined || ssl === null || ssl === false) return false;
  if (typeof ssl === 'object') return ssl as Record<string, unknown>;
  const mode = String(ssl).toLowerCase();
  if (mode === 'disable' || mode === 'false' || mode === '0' || mode === 'off') return false;
  if (mode === 'verify-ca' || mode === 'verify-full') return {};
  return { rejectUnauthorized: false };
}

// Exact-precision values: dates/timestamps stay strings (int8 and numeric
// already arrive as strings from node-postgres). Never JS Dates or floats.
pg.types.setTypeParser(1082, (v: string) => v);
pg.types.setTypeParser(1114, (v: string) => v);
pg.types.setTypeParser(1184, (v: string) => v);

export class PgExecutor implements Executor {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    const parsed = parseConnectionString(connectionString);
    this.pool = new pg.Pool({
      host: parsed.host ?? undefined,
      port: parsed.port ? Number(parsed.port) : undefined,
      user: parsed.user ?? undefined,
      password: parsed.password ?? undefined,
      database: parsed.database ?? undefined,
      ssl: normalizeSsl(parsed.ssl),
      max: 2,
    });
    // A dropped socket emits on idle pool clients; without this it becomes an
    // uncaughtException that bypasses the JSON error contract.
    this.pool.on('error', () => {});
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
