import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dpapiProtect, dpapiUnprotect } from './dpapi.js';
import { CliError } from '../cli/errors.js';

/*
 * Connection store: ~/.openquery/connections.json
 *
 *   { "mydb": { "kind": "postgres", "dpapi": true,  "credential": "<base64>" },
 *     "demo": { "kind": "pglite",   "dataDir": "<abs path>" } }
 *
 * The credential is the ONLY secret; agents address connections by alias.
 * POSIX: file mode 600. Windows: credential DPAPI-encrypted (user scope);
 * NTFS has no POSIX modes, so chmod is a no-op there by design.
 */

export type ConnectionEntry =
  | { kind: 'postgres'; dpapi: boolean; credential: string }
  | { kind: 'pglite'; dataDir: string };

export function openqueryHome(): string {
  return process.env.OPENQUERY_HOME ?? path.join(os.homedir(), '.openquery');
}

function storePath(): string {
  return path.join(openqueryHome(), 'connections.json');
}

async function readStore(): Promise<Record<string, ConnectionEntry>> {
  try {
    return JSON.parse(await fs.readFile(storePath(), 'utf8')) as Record<string, ConnectionEntry>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

async function writeStore(store: Record<string, ConnectionEntry>): Promise<void> {
  await fs.mkdir(openqueryHome(), { recursive: true, mode: 0o700 });
  await fs.writeFile(storePath(), JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
  await fs.chmod(storePath(), 0o600).catch(() => {}); // no-op on NTFS, by design
}

export interface SaveResult {
  /** false = DPAPI unavailable, stored plaintext — caller MUST warn loudly. */
  encrypted: boolean;
}

export async function saveConnection(alias: string, connectionString: string): Promise<SaveResult> {
  const store = await readStore();
  const protectedValue = dpapiProtect(connectionString);
  store[alias] =
    protectedValue !== null
      ? { kind: 'postgres', dpapi: true, credential: protectedValue }
      : {
          kind: 'postgres',
          dpapi: false,
          credential: Buffer.from(connectionString, 'utf8').toString('base64'),
        };
  await writeStore(store);
  return { encrypted: protectedValue !== null };
}

export async function savePgliteConnection(alias: string, dataDir: string): Promise<void> {
  const store = await readStore();
  store[alias] = { kind: 'pglite', dataDir };
  await writeStore(store);
}

export async function hasConnection(alias: string): Promise<boolean> {
  return alias in (await readStore());
}

export type ResolvedConnection =
  | { kind: 'postgres'; connectionString: string }
  | { kind: 'pglite'; dataDir: string };

export async function resolveConnection(alias: string): Promise<ResolvedConnection> {
  const store = await readStore();
  const entry = store[alias];
  if (!entry) {
    throw new CliError(
      'UNKNOWN_ALIAS',
      `no connection named '${alias}'`,
      `Ask the user to run: openquery connect ${alias}  (in their own terminal — the AI never handles the connection string).`
    );
  }
  if (entry.kind === 'pglite') return { kind: 'pglite', dataDir: entry.dataDir };

  if (entry.dpapi) {
    const plain = dpapiUnprotect(entry.credential);
    if (plain === null) {
      throw new CliError(
        'CONNECT_FAILED',
        `could not decrypt credential for '${alias}' (DPAPI unavailable)`,
        `Re-run: openquery connect ${alias}`
      );
    }
    return { kind: 'postgres', connectionString: plain };
  }
  return {
    kind: 'postgres',
    connectionString: Buffer.from(entry.credential, 'base64').toString('utf8'),
  };
}
