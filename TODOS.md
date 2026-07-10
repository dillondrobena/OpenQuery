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

## Keyboard navigation for the viewer graph (FINDING-012, /design-review 2026-07-10)

- **What:** A keyboard path to the viewer's core interaction: roving focus across nodes/edges (Tab/arrows), Enter opens the receipt, Escape clears. Announce selection to assistive tech.
- **Why:** Every receipt today requires a mouse click on a canvas. Keyboard and screen-reader users cannot reach the product's core function. Flagged high by both outside voices (Codex + Claude subagent) in the design review.
- **Pros:** Closes the one a11y-critical gap; the aria-live panel (FINDING-008) already announces content once selection works.
- **Cons:** Canvas-based graphs have no free a11y — needs a focus model, visible focus indicator drawn on canvas, and key handling that coexists with force-graph's zoom/pan.
- **Context:** viewer/app.js registers onNodeClick/onLinkClick handlers; a keyboard layer can reuse renderReceipt() directly (the same path automated QA uses). Design audit: ~/.gstack/projects/OpenQuery/designs/design-audit-20260710/.
- **Depends on:** nothing; viewer-only.

## Mobile edge-label declutter (polish, /design-review 2026-07-10)

- **What:** On narrow viewports/tight clusters, edge label pills overlap ("$48,200" over "Dana Reyes" at 375px). Hide labels below a zoom threshold on touch, or offset/fan overlapping labels.
- **Why:** Mobile is now structurally sound (stacked layout) but dense graphs get noisy at phone width.
- **Pros:** Cheap heuristic (skip label when pill width > edge screen length). **Cons:** Pure polish; pinch-zoom already mitigates.
- **Context:** viewer/app.js linkCanvasObject; label drawing is one function.
- **Depends on:** nothing.

## Admin/filesystem function denylist in the guard (adversarial review, 2026-07-10)

- **What:** Reject (or gate behind a flag) SELECTs calling admin/filesystem functions: `pg_read_file`, `pg_ls_dir`, `pg_read_binary_file`, `lo_import/export`, `dblink*`, plus direct reads of `pg_authid`/`pg_shadow`.
- **Why:** On a superuser connection these are "read-only" but reveal server files and password hashes — technically consistent with the promise, practically an embarrassing demo (`SELECT pg_read_file('/etc/passwd')`).
- **Pros:** Closes the gap between the literal and the implied safety promise. **Cons:** Function denylists are never complete (extensions add more); the honest fence remains the read-only role, which the docs and the superuser warning now push hard.
- **Context:** Flagged P2/confidence-6 by the pre-publish adversarial review. v0.1.0.0 mitigations: superuser detection in the connect warning + README language. The AST walk in src/safety/guard.ts already visits FuncCall nodes — the hook point exists.
- **Depends on:** nothing.

## Optional MCP adapter (alias-only)

- **What:** Thin MCP server wrapping the same CLI core for MCP-only hosts.
- **Why:** Widens distribution to the largest tool ecosystem without changing the primary Skill+CLI form factor.
- **Pros:** Reuses the entire engine; pure distribution win.
- **Cons:** Reintroduces the "hand a server your DB access" *perception* the project was founded against — framing must be exact: the adapter only ever sees connection **aliases**; `connect` remains user-run in a terminal, so credentials never reach the MCP layer either.
- **Context:** Deferred in the office-hours design (D9) because trust perception drove the form factor. The alias-only architecture means the original objection is technically defused; re-decide with adoption data.
- **Depends on:** v1 CLI shipped.
