#!/usr/bin/env node
import { Command } from 'commander';
import { emitErrorAndExit } from './errors.js';
import { connectCommand } from './commands/connect.js';
import { queryCommand } from './commands/query.js';
import { schemaCommand } from './commands/schema.js';
import { graphCommand, serveDetached } from './commands/graph.js';
import { demoCommand } from './commands/demo.js';

/*
 * openquery — evidence explorer for databases.
 * Read-only by construction; credentials enter via the interactive
 * `connect` prompt only and are never printed, logged, or shown to agents.
 */

const cleanups: Array<() => Promise<void>> = [];
const registerCleanup = (fn: () => Promise<void>): void => {
  cleanups.push(fn);
};

async function runCleanups(): Promise<void> {
  for (const fn of cleanups.splice(0)) {
    await fn().catch(() => {});
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void runCleanups().then(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  });
}

// Last-resort guard: the error contract (one JSON object on stderr) holds even
// for crashes that escape command-level handling — users and agents must never
// see a raw stack trace. Found by real-user dogfooding (pg SSL crash).
for (const event of ['uncaughtException', 'unhandledRejection'] as const) {
  process.on(event, (err: unknown) => {
    void runCleanups().finally(() => emitErrorAndExit(err));
  });
}

const program = new Command();
program
  .name('openquery')
  .description('Safely explore a database with an AI agent: guarded read-only SQL, entity graphs with SQL receipts.')
  .version('0.1.0');

program
  .command('connect')
  .argument('<alias>', 'name agents will use — they never see the connection string')
  .description('Interactively store a Postgres connection (user-run only; requires a real terminal)')
  .action(async (alias: string) => {
    await connectCommand(alias);
  });

program
  .command('query')
  .argument('<alias>', 'connection alias')
  .requiredOption('--sql <sql>', 'a single SELECT / WITH...SELECT / plain EXPLAIN')
  .option('--params <json>', 'JSON array of bind parameters ($1, $2, ...) — values never go in SQL text')
  .option('--out <file>', 'write the full (row-capped) result set to a file')
  .option('--max-rows <n>', 'row cap (default 500)', (v) => Number.parseInt(v, 10))
  .option('--timeout <ms>', 'statement timeout in ms (default 10000)', (v) => Number.parseInt(v, 10))
  .description('Run a guarded read-only query; prints a sample + receipt envelope')
  .action(async (alias: string, opts: { sql: string; params?: string; out?: string; maxRows?: number; timeout?: number }) => {
    await queryCommand(alias, {
      sql: opts.sql,
      params: opts.params,
      out: opts.out,
      maxRows: opts.maxRows,
      timeoutMs: opts.timeout,
    });
  });

program
  .command('schema')
  .argument('<alias>', 'connection alias')
  .option('--table <name>', 'full column detail for one table')
  .option('--filter <glob>', "scope the summary, e.g. --filter 'tx*'")
  .description('Inspect the schema (summary by default — fits agent context on large databases)')
  .action(async (alias: string, opts: { table?: string; filter?: string }) => {
    await schemaCommand(alias, opts);
  });

program
  .command('graph')
  .requiredOption('--input <file>', 'Graph JSON v1 file (see schema/graph.schema.json)')
  .option('--no-wait', 'detach the viewer server and return immediately')
  .description('Validate Graph JSON and open the evidence explorer')
  .action(async (opts: { input: string; wait: boolean }) => {
    await graphCommand({ input: opts.input, wait: opts.wait }, registerCleanup);
  });

program
  .command('demo')
  .option('--serve-db', 'only initialize the demo database + alias (for the agent-driven workflow)')
  .option('--no-wait', 'render, print the graph path, and exit instead of serving until Ctrl+C')
  .description('Zero-setup demo: seeded embedded Postgres, scripted flagship question, live receipts')
  .action(async (opts: { serveDb?: boolean; wait: boolean }) => {
    await demoCommand({ serveDb: opts.serveDb, wait: opts.wait }, registerCleanup);
  });

program
  .command('__serve <file>', { hidden: true })
  .description('internal: detached viewer process behind --no-wait')
  .action(async (file: string) => {
    await serveDetached(file);
  });

program.parseAsync().catch(async (err: unknown) => {
  await runCleanups();
  emitErrorAndExit(err);
});
