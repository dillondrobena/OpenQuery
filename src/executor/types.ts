export interface QueryOptions {
  params?: unknown[];
  /** Row cap: reading stops past this count; `truncated` reports it. Default 500. */
  maxRows?: number;
  /** Server-side statement timeout. Default 10s. */
  timeoutMs?: number;
}

export interface QueryOutcome {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  columns: string[];
  durationMs: number;
}

/*
 * One interface, two backends:
 *
 *   agent SQL ─▶ guard ─▶ Executor.query()
 *                           ├─ PgExecutor     (node-postgres: RO txn, SET LOCAL
 *                           │                  statement_timeout, cursor row cap)
 *                           └─ PgliteExecutor (in-process WASM: RO txn, lockfile
 *                                              for the single-connection limit)
 *
 * Both emit identical value shapes: numeric/int8/date/timestamp as strings,
 * never JS floats or Dates — receipts show money and must be exact.
 */
export interface Executor {
  query(sql: string, opts?: QueryOptions): Promise<QueryOutcome>;
  close(): Promise<void>;
}

export const DEFAULT_MAX_ROWS = 500;
export const DEFAULT_TIMEOUT_MS = 10_000;

/** NaN/zero/negative silently disabled the cap (adversarial finding) — sanitize at the executor boundary too, not just the CLI. */
export function sanitizeLimit(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : fallback;
}
