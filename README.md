# OpenQuery

[![npm version](https://img.shields.io/npm/v/openquery)](https://www.npmjs.com/package/openquery)
[![CI](https://github.com/dillondrobena/OpenQuery/actions/workflows/ci.yml/badge.svg)](https://github.com/dillondrobena/OpenQuery/actions/workflows/ci.yml)

**Evidence explorer for databases.** Ask an AI agent questions about your
Postgres data — get back an interactive entity graph where **every edge carries
a SQL receipt**: the exact query, bound parameters, join path, and sampled rows
that justify it.

Two guarantees, enforced in code, not policy:

1. **Your credentials never enter the AI's context.** You type the connection
   string into your own terminal (`openquery connect mydb`); the command
   refuses to run without an interactive terminal, takes no credential
   arguments, and reads no env vars. Agents only ever use the alias.
2. **Physically read-only.** Every query runs through PostgreSQL's own parser
   (compiled to WASM): one statement, `SELECT`-shaped only — CTE-embedded
   writes, multi-statements, `SET`, `EXPLAIN ANALYZE`, `SELECT INTO`, and
   `FOR UPDATE` are all rejected — then executes inside a `READ ONLY`
   transaction with a statement timeout and a row cap.

## Try it in 90 seconds (no database, no credentials, no LLM)

```bash
npx openquery demo
```

Boots a seeded embedded Postgres, runs the flagship question — *"Show me the
relationship between user 42 and companies Acme, Globex, and Initech based on
their transactions"* — through the real guard + read-only pipeline, and opens
the evidence explorer. Click an edge: the receipt shows the SQL, params, and
rows behind it.

Assumes Node ≥ 20 and a default browser. The demo database is embedded
Postgres ([PGlite](https://pglite.dev)) — same dialect as a real server, not
every operational behavior.

## Use it with your agent

OpenQuery ships as an [Agent Skill](./SKILL.md) — agent- and model-agnostic.

```bash
npm install -g openquery     # or keep using npx
openquery connect mydb       # you run this; input hidden; stored locally
```

Claude Code users can install the skill as a plugin in two commands:

```
/plugin marketplace add dillondrobena/OpenQuery
/plugin install openquery@openquery
```

Any other agent: point it at `SKILL.md` (or copy it to your agent's skills
directory). The agent workflow: inspect schema summary →
iterate guarded parameterized queries → assemble Graph JSON → render.

```bash
openquery schema mydb                             # tables + row estimates + FKs
openquery query mydb --sql "SELECT ... WHERE id = $1" --params '[42]'
openquery graph --input graph.json                # evidence explorer on localhost
```

## Honest limits (read before pointing this at production)

- **v1 graphs are agent-asserted.** The viewer badges this. Receipts show the
  real SQL per edge and the join path is computed from the query's AST by the
  CLI — but nodes/edges themselves are assembled by the agent. v2 derives the
  whole graph from the queries.
- **Credential storage:** Windows uses DPAPI (user scope); elsewhere a file
  with owner-only permissions. This protects against other OS users — not
  against a program running as *you*. The structural guarantee is narrower and
  stronger: the string never appears in agent context, transcripts, CLI
  output, audit log, or viewer payload (CI enforces this with a canary test).
- **The viewer serves rows to your browser** on 127.0.0.1 behind a random URL
  token. The token is a local-process guard; browser cache, extensions, and
  devtools are still your machine's trust domain. Detached viewers
  (`graph --no-wait`) shut themselves down after 4 hours so forgotten servers
  don't hold data forever.
- **A SELECT can still be expensive — or privileged.** Timeouts and row caps
  bound runtime, but on a superuser connection even read-only functions like
  `pg_read_file()` reveal more than table data. The strongest fence is
  connecting with a minimally-privileged read-only role (`connect` warns —
  best-effort, including superuser detection — when the role is over-privileged).
- **`sslmode=require` / `ssl=true` means TLS without certificate verification**
  (libpq `require` semantics). Use `sslmode=verify-full` for verified TLS.
- **The audit log** (`~/.openquery/audit.jsonl`) records SQL + params, never
  result rows. Params can contain sensitive literals; redaction is on the
  roadmap ([TODOS](./TODOS.md)).

## Development

```bash
npm ci
npm test          # guard matrix, executor parity, E2E CLI, canary, drift gate
npm run build
```

Want to contribute? Start with [CONTRIBUTING.md](./CONTRIBUTING.md) — setup,
test house rules, and a curated backlog. Architecture and the safety model are
documented in [CLAUDE.md](./CLAUDE.md); deferred work with full context lives
in [TODOS.md](./TODOS.md). The Graph JSON
contract is [schema/graph.schema.json](./schema/graph.schema.json) (frozen v1);
the SKILL.md example is CI-validated against it so the two cannot drift.

MIT © Dillon Drobena
