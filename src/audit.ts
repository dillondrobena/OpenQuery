import { promises as fs } from 'node:fs';
import path from 'node:path';
import { openqueryHome } from './config/store.js';

/*
 * Audit log: one JSONL line per query at ~/.openquery/audit.jsonl.
 * Never result rows. SQL + params can contain sensitive literals — documented
 * limitation; redaction option is TODO-tracked.
 *
 * Write failure NEVER blocks the query (warn-and-continue, eng review D18):
 * a full disk must not brick the tool — but failure is always announced on
 * stderr, so silent audit holes are impossible.
 */

export interface AuditEntry {
  ts: string;
  alias: string;
  sql: string;
  params: unknown[];
  rowCount: number | null;
  durationMs: number | null;
  status: 'ok' | 'error';
}

export async function appendAudit(entry: AuditEntry): Promise<void> {
  const auditPath = path.join(openqueryHome(), 'audit.jsonl');
  try {
    await fs.mkdir(openqueryHome(), { recursive: true, mode: 0o700 });
    await fs.appendFile(auditPath, JSON.stringify(entry) + '\n', { mode: 0o600 });
  } catch (err) {
    process.stderr.write(
      `WARNING: audit log write failed (${auditPath}): ` +
        `${err instanceof Error ? err.message : String(err)} — query proceeded; audit is best-effort.\n`
    );
  }
}
