/*
 * Error contract: agents consume errors programmatically, so every failure is
 * exactly one JSON object on stderr with a stable code, then a non-zero exit.
 * Zero-row results are success, not errors.
 */

export type ErrorCode =
  | 'UNKNOWN_ALIAS'
  | 'CONNECT_FAILED'
  | 'GUARD_REJECTED'
  | 'PARSE_ERROR'
  | 'TIMEOUT'
  | 'VIEWER_ERROR';

export class CliError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly hint?: string
  ) {
    super(message);
  }
}

export function emitErrorAndExit(err: unknown): never {
  const payload =
    err instanceof CliError
      ? { error: { code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}) } }
      : {
          error: {
            code: 'CONNECT_FAILED' as const,
            message: err instanceof Error ? err.message : String(err),
          },
        };
  process.stderr.write(JSON.stringify(payload) + '\n');
  process.exit(1);
}

/** Postgres statement_timeout and lock timeouts map to the TIMEOUT code. */
export function mapDbError(err: unknown): CliError {
  const message = err instanceof Error ? err.message : String(err);
  if (/statement timeout|canceling statement due to/i.test(message)) {
    return new CliError('TIMEOUT', `query exceeded the statement timeout: ${message}`, 'Narrow the query (add filters or reduce scanned rows) and retry.');
  }
  if (/could not acquire lock/i.test(message)) {
    return new CliError('TIMEOUT', message, 'Another openquery invocation holds the demo database. Retry in a moment.');
  }
  return new CliError('CONNECT_FAILED', message);
}
