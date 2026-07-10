import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { acquireLock } from './lockfile.js';
import {
  DEFAULT_MAX_ROWS,
  DEFAULT_TIMEOUT_MS,
  type Executor,
  type QueryOptions,
  type QueryOutcome,
} from './types.js';

// Exact-precision parity with PgExecutor: keep these types as raw strings.
// oids: int8=20, numeric=1700, date=1082, timestamp=1114, timestamptz=1184
const RAW_STRING_PARSERS: Record<number, (value: string) => string> = {
  20: (v) => v,
  1700: (v) => v,
  1082: (v) => v,
  1114: (v) => v,
  1184: (v) => v,
};

export interface PgliteExecutorOptions {
  /** File-backed data dir; omit for ephemeral in-memory (tests). */
  dataDir?: string;
  lockTimeoutMs?: number;
}

export class PgliteExecutor implements Executor {
  private db: PGlite | null = null;
  private releaseLock: (() => Promise<void>) | null = null;

  constructor(private readonly options: PgliteExecutorOptions = {}) {}

  private async open(): Promise<PGlite> {
    if (this.db) return this.db;
    if (this.options.dataDir) {
      // PGlite is single-connection; serialize concurrent CLI invocations.
      this.releaseLock = await acquireLock(
        path.join(path.dirname(this.options.dataDir), `${path.basename(this.options.dataDir)}.lock`),
        this.options.lockTimeoutMs
      );
    }
    // Options must be the sole argument when there is no dataDir — PGlite does
    // not apply an options object passed after an undefined first argument.
    this.db = this.options.dataDir
      ? new PGlite(this.options.dataDir, { parsers: RAW_STRING_PARSERS })
      : new PGlite({ parsers: RAW_STRING_PARSERS });
    await this.db.waitReady;
    return this.db;
  }

  /** For seeding: multi-statement DDL/DML, bypasses nothing — never exposed to agent SQL. */
  async execRaw(sql: string): Promise<void> {
    const db = await this.open();
    await db.exec(sql);
  }

  async query(sql: string, opts: QueryOptions = {}): Promise<QueryOutcome> {
    const db = await this.open();
    const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const started = Date.now();

    await db.exec('BEGIN TRANSACTION READ ONLY');
    try {
      await db.exec(`SET LOCAL statement_timeout = ${Math.floor(timeoutMs)}`);
      const result = await db.query<Record<string, unknown>>(sql, (opts.params ?? []) as unknown[]);
      const truncated = result.rows.length > maxRows;
      const rows = truncated ? result.rows.slice(0, maxRows) : result.rows;
      return {
        rows,
        rowCount: rows.length,
        truncated,
        columns: result.fields.map((f) => f.name),
        durationMs: Date.now() - started,
      };
    } finally {
      await db.exec('ROLLBACK').catch(() => {});
    }
  }

  async close(): Promise<void> {
    await this.db?.close().catch(() => {});
    this.db = null;
    if (this.releaseLock) {
      await this.releaseLock();
      this.releaseLock = null;
    }
  }
}
