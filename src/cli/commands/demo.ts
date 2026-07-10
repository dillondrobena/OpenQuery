import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PgliteExecutor } from '../../executor/pglite.js';
import { validateSql } from '../../safety/guard.js';
import { appendAudit } from '../../audit.js';
import { CliError, mapDbError } from '../errors.js';
import { openqueryHome, savePgliteConnection } from '../../config/store.js';
import { demoDataDir } from '../resolve.js';
import { validateGraphDocument } from './graph.js';
import { openInBrowser, serveGraph } from '../../viewer/server.js';

/*
 * demo — fully canned, no LLM involved. Boots the seeded PGlite database,
 * replays the scripted flagship queries THROUGH the real guard + executor
 * pipeline, assembles Graph JSON with live receipts, and serves the viewer.
 * Proves the whole machine in one command with zero credentials or config.
 *
 * --serve-db only initializes the data dir and registers the `demo` alias so
 * an agent can drive the SKILL.md workflow against the same database.
 */

const FLAGSHIP_QUESTION =
  'Show me the relationship between user 42 and companies Acme, Globex, and Initech based on their transactions';

const EDGE_SQL = `SELECT t.id, t.amount, t.created_at
FROM transactions t
JOIN accounts a ON a.id = t.account_id
JOIN companies c ON c.id = t.company_id
WHERE a.user_id = $1
  AND c.name = $2
ORDER BY t.created_at DESC`;

const COMPANIES_SQL = `SELECT c.id, c.name, count(*) AS txn_count, sum(t.amount) AS total
FROM transactions t
JOIN accounts a ON a.id = t.account_id
JOIN companies c ON c.id = t.company_id
WHERE a.user_id = $1 AND c.name = ANY($2)
GROUP BY c.id, c.name ORDER BY total DESC`;

const USER_SQL = 'SELECT id, name FROM users WHERE id = $1';

function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

function formatMoney(numeric: string): string {
  const [whole = '0', cents = '00'] = numeric.split('.');
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents.padEnd(2, '0').slice(0, 2)}`;
}

async function ensureSeeded(dataDir: string): Promise<void> {
  const marker = path.join(path.dirname(dataDir), '.seeded');
  try {
    await fs.access(marker);
    return;
  } catch {
    /* not yet seeded */
  }
  const root = packageRoot();
  const executor = new PgliteExecutor({ dataDir });
  try {
    await executor.execRaw(await fs.readFile(path.join(root, 'demo', 'schema.sql'), 'utf8'));
    await executor.execRaw(await fs.readFile(path.join(root, 'demo', 'seed.sql'), 'utf8'));
  } finally {
    await executor.close();
  }
  await fs.writeFile(marker, new Date().toISOString() + '\n', 'utf8');
}

/** Run one scripted query through the real guard + executor + audit pipeline. */
async function scriptedQuery(
  executor: PgliteExecutor,
  sql: string,
  params: unknown[]
): Promise<{ rows: Array<Record<string, unknown>>; joinPath: string[]; ranAt: string; durationMs: number; rowCount: number }> {
  const verdict = await validateSql(sql);
  if (!verdict.ok) throw new CliError(verdict.code, `demo pipeline: ${verdict.message}`, verdict.hint);
  const ranAt = new Date().toISOString();
  const outcome = await executor.query(sql, { params }).catch((err) => {
    throw mapDbError(err);
  });
  await appendAudit({
    ts: ranAt,
    alias: 'demo',
    sql,
    params,
    rowCount: outcome.rowCount,
    durationMs: outcome.durationMs,
    status: 'ok',
  });
  return { rows: outcome.rows, joinPath: verdict.joinPath, ranAt, durationMs: outcome.durationMs, rowCount: outcome.rowCount };
}

export interface DemoCommandOptions {
  serveDb?: boolean;
  wait: boolean;
}

export async function demoCommand(
  opts: DemoCommandOptions,
  registerCleanup: (fn: () => Promise<void>) => void
): Promise<void> {
  const home = openqueryHome();
  const dataDir = demoDataDir(home);
  await ensureSeeded(dataDir);
  await savePgliteConnection('demo', dataDir);

  if (opts.serveDb) {
    process.stdout.write(
      `Demo database ready (embedded Postgres, read-only pipeline).\n` +
        `Alias registered: demo\n` +
        `Try the agent workflow from SKILL.md, or by hand:\n` +
        `  openquery schema demo\n` +
        `  openquery query demo --sql "SELECT * FROM users" \n`
    );
    return;
  }

  const executor = new PgliteExecutor({ dataDir });
  registerCleanup(() => executor.close());
  const companies = ['Acme Corp', 'Globex', 'Initech'];

  const user = await scriptedQuery(executor, USER_SQL, [42]);
  const userRow = user.rows[0];
  if (!userRow) throw new CliError('VIEWER_ERROR', 'demo database missing user 42 — delete ~/.openquery/demo and retry');

  const agg = await scriptedQuery(executor, COMPANIES_SQL, [42, companies]);

  const nodes = [
    { id: 'user:42', type: 'user', label: String(userRow.name), sourceTable: 'users', pk: 42 },
    ...agg.rows.map((row) => ({
      id: `company:${row.id}`,
      type: 'company',
      label: String(row.name),
      sourceTable: 'companies',
      pk: Number(row.id),
    })),
  ];

  const edges = [];
  for (const row of agg.rows) {
    const detail = await scriptedQuery(executor, EDGE_SQL, [42, row.name]);
    edges.push({
      id: `e-${String(row.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      source: 'user:42',
      target: `company:${row.id}`,
      label: `${formatMoney(String(row.total))} · ${row.txn_count} txn${row.txn_count === '1' ? '' : 's'}`,
      weight: Number(row.txn_count),
      receipt: {
        sql: EDGE_SQL,
        params: [42, row.name],
        rowCount: detail.rowCount,
        sampledRows: detail.rows.slice(0, 4),
        joinPath: detail.joinPath,
        ranAt: detail.ranAt,
        durationMs: detail.durationMs,
      },
    });
  }
  await executor.close();

  const doc = {
    version: 1 as const,
    question: FLAGSHIP_QUESTION,
    connection: 'demo',
    nodes,
    edges,
  };

  const outPath = path.join(home, 'demo', 'flagship.json');
  await fs.writeFile(outPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  const validated = await validateGraphDocument(JSON.stringify(doc));

  const served = await serveGraph(validated);
  registerCleanup(served.close);
  process.stdout.write(
    `Demo ran the flagship question through the real guard + read-only pipeline (no LLM involved).\n` +
      `Graph JSON: ${outPath}\n` +
      `Evidence explorer: ${served.url}\n` +
      `Click an edge — the receipt shows the exact SQL, params, and rows behind it.\n`
  );
  openInBrowser(served.url);

  if (opts.wait) {
    process.stdout.write('Serving until Ctrl+C.\n');
    await new Promise(() => {});
  } else {
    await served.close();
    process.stdout.write(`Viewer closed (--no-wait). Re-open anytime: openquery graph --input "${outPath}"\n`);
  }
}
