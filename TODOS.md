# TODOS

Deferred work with context. Generated during /plan-eng-review on 2026-07-09; design doc: `~/.gstack/projects/OpenQuery/dillo-master-design-20260709-134905.md`.

## Audit-log sensitive-literal redaction (opt-in)

- **What:** Config flag (e.g. `audit_redact_params: true`) that hashes/masks parameter values in audit lines — SQL shape and param count preserved, raw values not.
- **Why:** Audit lines store SQL + params, which can contain emails, names, account IDs. "Never result rows" is not a complete privacy story (Codex outside-voice finding).
- **Pros:** Closes the last data-at-rest gap for privacy-sensitive users; cheap once `--params` exists (values arrive as a discrete array, trivially maskable).
- **Cons:** Redacted audits are less useful for debugging; one more config knob.
- **Context:** v1 documents the limitation in the Safety Model. `--params` (eng review D11) is what makes clean redaction possible — values never need parsing out of SQL text.
- **Depends on:** `--params` implementation (v1).

## Schema/RLS-aware role privilege analysis ("openquery doctor")

- **What:** Replace the best-effort write-grant warning with a real privilege walk: table grants, default privileges, RLS policies, function EXECUTE — an accurate "this role can write to X, Y" report at connect time.
- **Why:** The shallow check either misses real write paths or produces noise (Codex finding). An accurate report actively helps users provision the minimal read-only role the docs recommend.
- **Pros:** Converts a hedged warning into a genuinely useful security feature; natural `openquery doctor` command.
- **Cons:** Postgres privilege resolution is a deep rabbit hole — role inheritance, PUBLIC grants, RLS interplay. Real maintenance surface; scope deliberately before starting.
- **Context:** v1 ships the warning explicitly labeled "best-effort" (eng review D12). This TODO is the honest-label-to-real-feature upgrade.
- **Depends on:** Nothing; independently buildable post-v1.

## Audit log rotation / size cap

- **What:** Rotate `~/.openquery/audit.jsonl` at ~50MB, keep 3 files (suggested defaults).
- **Why:** One line per query, forever — heavy agent workflows write thousands of lines/day; unbounded growth becomes a "why is .openquery 4GB" support issue.
- **Pros:** Tiny, standard, prevents a silly future problem.
- **Cons:** None real; just picking numbers.
- **Context:** Flagged in eng-review performance section; not a v1 blocker at human timescales. ~20-minute task.
- **Depends on:** Nothing.

## Optional MCP adapter (alias-only)

- **What:** Thin MCP server wrapping the same CLI core for MCP-only hosts.
- **Why:** Widens distribution to the largest tool ecosystem without changing the primary Skill+CLI form factor.
- **Pros:** Reuses the entire engine; pure distribution win.
- **Cons:** Reintroduces the "hand a server your DB access" *perception* the project was founded against — framing must be exact: the adapter only ever sees connection **aliases**; `connect` remains user-run in a terminal, so credentials never reach the MCP layer either.
- **Context:** Deferred in the office-hours design (D9) because trust perception drove the form factor. The alias-only architecture means the original objection is technically defused; re-decide with adoption data.
- **Depends on:** v1 CLI shipped.
