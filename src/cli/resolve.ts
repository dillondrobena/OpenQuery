import path from 'node:path';
import { PgExecutor } from '../executor/pg.js';
import { PgliteExecutor } from '../executor/pglite.js';
import type { Executor } from '../executor/types.js';
import { resolveConnection } from '../config/store.js';

export interface ResolvedExecutor {
  executor: Executor;
  kind: 'postgres' | 'pglite';
}

export async function executorForAlias(alias: string): Promise<ResolvedExecutor> {
  const resolved = await resolveConnection(alias);
  if (resolved.kind === 'pglite') {
    return {
      executor: new PgliteExecutor({ dataDir: resolved.dataDir }),
      kind: 'pglite',
    };
  }
  return { executor: new PgExecutor(resolved.connectionString), kind: 'postgres' };
}

export function demoDataDir(home: string): string {
  return path.join(home, 'demo', 'pgdata');
}
