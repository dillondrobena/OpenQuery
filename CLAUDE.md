# OpenQuery

Evidence explorer for databases: agent-agnostic Skill + local CLI that runs
guarded read-only SQL against Postgres and renders entity graphs with SQL
receipts. Design record: ~/.gstack/projects/OpenQuery/ (design doc + test plan).

## Architecture (v1)

- `src/safety/guard.ts` — THE chokepoint: real PG parser (pgsql-parser, WASM);
  single-statement SELECT/WITH-SELECT/plain-EXPLAIN allowlist, deep `*Stmt`
  rejection, computed joinPath. Every allow/reject is a row in test/guard.test.ts.
- `src/executor/` — one interface, two backends (node-postgres, PGlite) with
  exact-precision string serialization parity; PGlite guarded by a PID lockfile.
- `src/cli/` — connect (TTY-only, DPAPI/0600), query (--params, envelope,
  audit), schema (summary-first), graph (validate + bounds + serve), demo.
- `viewer/` — static force-graph page served on 127.0.0.1 behind a URL token.
- Contract: `schema/graph.schema.json` (v1-draft) — SKILL.md example is
  CI-validated against it; `fixtures/flagship-graph.json` is the hand-written
  reference.

## Testing

- `npm test` — vitest: guard matrix (46), executor parity + lockfile, E2E CLI
  spawns, viewer token gate, DPAPI roundtrip (Windows), credential canary,
  SKILL.md contract drift gate.
- `TEST_PG_URL=postgres://...` enables the node-postgres parity suite (CI does).
- `npm run typecheck` / `npm run build` (tsc, ESM NodeNext).

## Release

- Two version files, always bumped together: `VERSION` holds 4-digit
  `MAJOR.MINOR.PATCH.MICRO` (gstack-internal); `package.json` holds the 3-digit
  npm semver. Any npm-visible release must bump at least PATCH.
- Ritual: bump both files → add CHANGELOG entry (user-voiced, dated) →
  `git tag v<MAJOR.MINOR.PATCH.MICRO>` → push the tag. `release.yml` tests,
  builds, and runs `npm publish --provenance`.
- Publishing is **npm Trusted Publishing (OIDC)** — the workflow authenticates
  by identity, no token exists anywhere. Never add an npm token or suggest
  token-based publishing; it will fail (and shouldn't be fixed by adding one).
- npm cannot republish an existing version; failed releases of an unpublished
  version can be retried via the workflow's manual dispatch.
- `gh` CLI is not installed on this machine — check CI via the public GitHub
  API or the Actions web UI.

## Invariants (do not weaken)

- Credentials: interactive `connect` prompt is the ONLY entry path — no args,
  no env vars, TTY required. Canary test enforces no leakage to output/audit.
- Guard: fail closed; new mutation vectors get a test row, never a special case.
- Numeric/int8/date values are strings end-to-end — receipts show money.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
