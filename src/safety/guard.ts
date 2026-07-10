import { parse } from 'pgsql-parser';

/*
 * The guard — OpenQuery's core promise, enforced at one chokepoint.
 *
 *            input SQL
 *                │
 *          parse (real PG parser, WASM)
 *                │ parse error ──▶ REJECT (PARSE_ERROR, fail closed)
 *                ▼
 *          exactly 1 statement? ──▶ REJECT (multi-statement)
 *                ▼
 *      top level: SelectStmt ─ or ─ ExplainStmt (no ANALYZE, inner must pass)
 *                ▼
 *      deep walk of the whole tree:
 *        any *Stmt other than SelectStmt/ExplainStmt ──▶ REJECT  (CTE DML, etc.)
 *        intoClause (SELECT INTO creates a table)    ──▶ REJECT
 *        lockingClause (FOR UPDATE/SHARE takes locks)──▶ REJECT
 *                ▼
 *             ALLOW + joinPath (RangeVars in order of appearance)
 *
 * The deep *Stmt rejection is deliberately generic: any statement node of any
 * kind embedded anywhere (CTEs, subqueries, future grammar) is caught without
 * naming it — fail closed by construction.
 */

export type GuardOk = { ok: true; joinPath: string[] };
export type GuardRejection = {
  ok: false;
  code: 'GUARD_REJECTED' | 'PARSE_ERROR';
  message: string;
  hint: string;
};
export type GuardResult = GuardOk | GuardRejection;

const ALLOWED_STMT_KEYS = new Set(['SelectStmt', 'ExplainStmt']);
const REWRITE_HINT =
  'Only a single read-only SELECT (or WITH ... SELECT, or plain EXPLAIN of one) is allowed. Rewrite the query and retry.';

function reject(message: string, code: GuardRejection['code'] = 'GUARD_REJECTED'): GuardRejection {
  return { ok: false, code, message, hint: REWRITE_HINT };
}

/** Deep-walk the parse tree; returns a rejection reason or null if clean. */
function findForbidden(node: unknown, topLevel: boolean): string | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const bad = findForbidden(item, topLevel);
      if (bad) return bad;
    }
    return null;
  }
  if (node === null || typeof node !== 'object') return null;

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    if (key.endsWith('Stmt') && !ALLOWED_STMT_KEYS.has(key)) {
      return `statement type ${key} is not allowed`;
    }
    if (key === 'ExplainStmt' && !topLevel) {
      return 'EXPLAIN is only allowed as the top-level statement';
    }
    if (key === 'intoClause') {
      return 'SELECT INTO creates a table and is not allowed';
    }
    if (key === 'lockingClause') {
      return 'row locking (FOR UPDATE/FOR SHARE) is not allowed';
    }
    const bad = findForbidden(value, false);
    if (bad) return bad;
  }
  return null;
}

/** Collect referenced tables (RangeVars) in order of appearance, deduped. */
function collectJoinPath(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectJoinPath(item, out);
    return;
  }
  if (node === null || typeof node !== 'object') return;

  const obj = node as Record<string, unknown>;
  const rangeVar = obj['RangeVar'] as Record<string, unknown> | undefined;
  if (rangeVar && typeof rangeVar['relname'] === 'string') {
    const schema = typeof rangeVar['schemaname'] === 'string' ? `${rangeVar['schemaname']}.` : '';
    const name = `${schema}${rangeVar['relname']}`;
    if (!out.includes(name)) out.push(name);
  }
  // The parse tree serializes withClause after the main clauses, but CTEs come
  // first in the SQL text — visit them first so joinPath reads in textual order.
  if (obj['withClause']) collectJoinPath(obj['withClause'], out);
  for (const [key, value] of Object.entries(obj)) {
    if (key !== 'withClause') collectJoinPath(value, out);
  }
}

function isAnalyzeExplain(explain: Record<string, unknown>): boolean {
  const options = explain['options'];
  if (!Array.isArray(options)) return false;
  return options.some((opt) => {
    const defElem = (opt as Record<string, unknown>)['DefElem'] as Record<string, unknown> | undefined;
    return typeof defElem?.['defname'] === 'string' && defElem['defname'].toLowerCase() === 'analyze';
  });
}

export async function validateSql(sql: string): Promise<GuardResult> {
  let tree: { stmts?: unknown[] };
  try {
    tree = (await parse(sql)) as { stmts?: unknown[] };
  } catch (err) {
    return reject(
      `SQL failed to parse: ${err instanceof Error ? err.message : String(err)}`,
      'PARSE_ERROR'
    );
  }

  const stmts = tree.stmts ?? [];
  if (stmts.length !== 1) {
    return reject(`expected exactly 1 statement, got ${stmts.length}`);
  }

  const stmtWrapper = (stmts[0] as Record<string, unknown>)['stmt'] as
    | Record<string, unknown>
    | undefined;
  if (!stmtWrapper) return reject('could not read parsed statement');

  const keys = Object.keys(stmtWrapper);
  const topKey = keys[0];
  if (keys.length !== 1 || !topKey || !ALLOWED_STMT_KEYS.has(topKey)) {
    return reject(`statement type ${topKey ?? 'unknown'} is not allowed`);
  }

  if (topKey === 'ExplainStmt') {
    const explain = stmtWrapper['ExplainStmt'] as Record<string, unknown>;
    if (isAnalyzeExplain(explain)) {
      return reject('EXPLAIN ANALYZE executes the query and is not allowed; use plain EXPLAIN');
    }
    const inner = explain['query'] as Record<string, unknown> | undefined;
    const innerKey = inner ? Object.keys(inner)[0] : undefined;
    if (innerKey !== 'SelectStmt') {
      return reject(`EXPLAIN of ${innerKey ?? 'unknown'} is not allowed; only EXPLAIN SELECT`);
    }
    const bad = findForbidden(inner, false);
    if (bad) return reject(bad);
  } else {
    const bad = findForbidden(stmtWrapper['SelectStmt'], false);
    if (bad) return reject(bad);
  }

  const joinPath: string[] = [];
  collectJoinPath(stmtWrapper, joinPath);
  return { ok: true, joinPath };
}
