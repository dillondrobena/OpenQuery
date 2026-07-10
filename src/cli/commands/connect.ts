import { PgExecutor } from '../../executor/pg.js';
import { CliError } from '../errors.js';
import { promptHidden, requireInteractiveTty } from '../prompt.js';
import { hasConnection, saveConnection } from '../../config/store.js';

/*
 * connect <alias> — user-run, enforced. No connection-string argument exists,
 * no env var is read; the interactive prompt is the only entry path. This is
 * what makes "the AI never sees your credentials" structural.
 */

export async function connectCommand(alias: string): Promise<void> {
  requireInteractiveTty();

  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(alias)) {
    throw new CliError(
      'CONNECT_FAILED',
      `invalid alias '${alias}'`,
      'Aliases are 1-64 chars: letters, digits, underscore, hyphen; must start with a letter.'
    );
  }

  if (await hasConnection(alias)) {
    const answer = await promptHiddenEcho(`Connection '${alias}' already exists. Overwrite? (y/N) `);
    if (answer.toLowerCase() !== 'y') {
      process.stdout.write('Aborted — existing connection unchanged.\n');
      return;
    }
  }

  process.stdout.write(
    `Paste the Postgres connection string for '${alias}'.\n` +
      `(Input is hidden. It is stored locally and never shown to any AI agent.)\n`
  );
  const connectionString = await promptHidden('connection string> ');
  if (connectionString.length === 0) {
    throw new CliError('CONNECT_FAILED', 'empty connection string', 'Nothing was stored.');
  }

  const probe = new PgExecutor(connectionString);
  try {
    await probe.ping().catch((err) => {
      throw new CliError(
        'CONNECT_FAILED',
        `could not connect: ${err instanceof Error ? err.message : String(err)}`,
        'Check host, port, database name, and credentials. Nothing was stored.'
      );
    });

    const writable = await probe.roleHasWriteGrants().catch(() => false);
    if (writable) {
      process.stdout.write(
        'WARNING (best-effort check): this role has INSERT/UPDATE/DELETE grants. OpenQuery enforces ' +
          'read-only transactions regardless, but a minimally-privileged read-only role is the stronger fence:\n' +
          `  CREATE ROLE openquery_ro LOGIN PASSWORD '...'; GRANT SELECT ON ALL TABLES IN SCHEMA public TO openquery_ro;\n`
      );
    }
  } finally {
    await probe.close();
  }

  const saved = await saveConnection(alias, connectionString);
  if (saved.encrypted) {
    process.stdout.write(`Saved '${alias}' (credential DPAPI-encrypted, user scope).\n`);
  } else if (process.platform === 'win32') {
    process.stdout.write(
      `WARNING: DPAPI unavailable (locked-down PowerShell?) — '${alias}' stored WITHOUT encryption in ` +
        `~/.openquery/connections.json. File permissions are the only protection. Prefer fixing PowerShell access.\n`
    );
  } else {
    process.stdout.write(`Saved '${alias}' (file mode 600 — owner-only).\n`);
  }
  process.stdout.write(`Agents can now use it by alias only: openquery query ${alias} --sql "SELECT ..."\n`);
}

/** Visible-echo variant for the y/N overwrite confirmation. */
async function promptHiddenEcho(promptText: string): Promise<string> {
  const readline = await import('node:readline');
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
