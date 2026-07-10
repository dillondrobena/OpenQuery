# Changelog

All notable changes to OpenQuery are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/) · Versions: MAJOR.MINOR.PATCH.MICRO (npm publishes MAJOR.MINOR.PATCH).

## [0.1.1.0] - 2026-07-10

### Changed
- npm package metadata: repository, homepage, bugs, and keywords — the npm page
  now links to GitHub, and provenance attestations bind to the repo.

## [0.1.0.0] - 2026-07-10

### Added
- Ask an AI agent questions about your Postgres data and get an interactive entity
  graph where every edge carries a SQL receipt — the exact query, bound parameters,
  computed join path, and sampled rows that prove the relationship.
- `openquery connect <alias>` — store a database connection by typing it into your
  own terminal; the AI only ever sees the alias, never the credential. Refuses to
  run non-interactively. DPAPI-encrypted storage on Windows, owner-only file elsewhere.
- `openquery query` — guarded, read-only, parameterized SQL: validated by
  PostgreSQL's own parser (single SELECT-shaped statements only; CTE-embedded
  writes, multi-statements, `SET`, `EXPLAIN ANALYZE`, `SELECT INTO`, `FOR UPDATE`
  all rejected), executed in a read-only transaction with row caps and timeouts,
  with an audit log of every query.
- `openquery schema` — summary-first schema inspection that fits large databases
  into agent context, with per-table drill-down.
- `openquery graph` — the evidence explorer: token-gated localhost viewer with
  always-visible edge labels, per-edge receipt panel, dark/light theme, mobile layout.
- `openquery demo` — zero-setup demo on an embedded Postgres: seeded data, the
  flagship question, live receipts, no credentials and no AI required.
- `SKILL.md` — agent-agnostic skill instructions (Agent Skills format) so any AI
  agent can drive the workflow; Graph JSON v1 contract frozen after clean-room
  agent dogfooding.
- CI: guard rejection matrix, executor parity against real Postgres, E2E CLI tests,
  credential-leak canary, and a SKILL.md/schema drift gate.

### Fixed
- Connection strings with `ssl=`/`sslmode=` options no longer crash `connect`
  (SSL config normalized before reaching the driver); any unexpected crash now
  reports a structured JSON error instead of a stack trace.
