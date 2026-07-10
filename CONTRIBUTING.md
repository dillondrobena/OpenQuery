# Contributing to OpenQuery

Thanks for considering it. This project's whole identity is trust — every edge
has a receipt, every promise is enforced in code — and contributions are held
to the same bar. This document tells you how to get running, what the
non-negotiables are, and where the good first issues live.

## Getting started

```bash
git clone https://github.com/dillondrobena/OpenQuery.git
cd OpenQuery
npm ci
npm test          # full suite, no database or credentials required
npm run build
node dist/cli/index.js demo   # seeded embedded Postgres → evidence explorer in your browser
```

Requirements: Node ≥ 20. That's it — the test suite and demo run on an embedded
Postgres (PGlite), no Docker, no local database, no API keys.

To exercise the CLI as users experience it: `npm link` puts `openquery` on your
PATH, pointed at your working `dist/` (rebuild after changes).

## Project layout

| Path | What it is |
|---|---|
| `src/safety/guard.ts` | **The product promise.** SQL validation on PostgreSQL's real parser: single-statement, SELECT-shaped only, fail closed. |
| `src/executor/` | One query interface, two backends: node-postgres (real servers) and PGlite (demo), with exact-precision output parity. |
| `src/cli/` | The commands: `connect`, `query`, `schema`, `graph`, `demo`. |
| `viewer/` | The evidence explorer — a static, framework-free page (force-graph canvas + receipt panel). |
| `schema/graph.schema.json` | Graph JSON v1, the frozen contract between agent, CLI, and viewer. |
| `SKILL.md` | The agent-facing instructions, published with the package. Its embedded example is CI-validated against the schema. |
| `test/` | Guard matrix, executor parity, E2E CLI spawns, credential canary, contract drift gate. |

## Testing

`npm test` runs everything locally except the node-postgres parity suite, which
needs a disposable server: `TEST_PG_URL=postgres://user:pass@localhost:5432/scratch npm test`
(CI provides one — both suites run on every PR, on Linux and Windows).

House rules, learned the hard way:

- **New mutation vector → new row in `test/guard.test.ts`. Never a code
  special-case.** The guard's allow/reject tables are the README's safety claims
  in executable form.
- **Test behavior, not existence.** `expect(x).toBeDefined()` is not a test.
  The suite asserts exact rows, exact error codes, exact rejections.
- **Money stays strings.** `numeric`/`int8`/dates serialize as strings
  end-to-end. A test that parses an amount to a float is a bug.
- **Errors are contract.** CLI failures emit one JSON object on stderr with a
  stable code (`GUARD_REJECTED`, `UNKNOWN_ALIAS`, `TIMEOUT`, …) and exit
  non-zero. Agents parse these; changing them is a breaking change.
- **The canary is sacred.** `test/contract-canary.test.ts` proves credentials
  never reach stdout, the audit log, or the store file in plaintext. If your
  change makes it fail, the change is wrong, not the test.

Developing the viewer needs no database at all — it's fixture-driven:

```bash
node dist/cli/index.js graph --input fixtures/flagship-graph.json
```

## Invariants (do not weaken)

The full list lives in [CLAUDE.md](./CLAUDE.md); the load-bearing three:

1. **Credentials enter through the interactive `connect` prompt only.** No
   flags, no env vars, no stdin pipes. This is what makes "the AI never sees
   your credentials" structural rather than aspirational.
2. **The guard fails closed.** Anything PostgreSQL's parser can't parse, or any
   statement shape not explicitly allowed, is rejected.
3. **Read-only is layered**, not single-point: AST guard + `READ ONLY`
   transaction + single-statement protocol. Don't remove a layer because
   another one "already covers it."

## Pull requests

- Keep commits logical and bisectable; conventional prefixes (`feat:`, `fix:`,
  `test:`, `docs:`, `chore:`) appreciated.
- Tests ship in the same PR as the behavior they cover.
- CI must be green on both platforms — Windows exists, and it has already
  caught real bugs here (CRLF, DPAPI, path handling).
- If you're changing the Graph JSON contract: don't. It's frozen at v1;
  breaking changes require a v2 discussion in an issue first.

## Looking for something to work on?

[TODOS.md](./TODOS.md) is the curated backlog, each item with context, tradeoffs,
and a starting point. Standouts: **keyboard navigation for the graph** (the one
known accessibility gap) and the **admin-function denylist** for the guard.

## Releases

Maintainer-only; the ritual is documented in [CLAUDE.md](./CLAUDE.md) under
"Release" (dual version files, tag push, tokenless OIDC publishing).
