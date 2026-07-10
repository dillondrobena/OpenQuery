import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { validateGraphDocument } from '../src/cli/commands/graph.js';

/*
 * Contract drift gate: the Graph JSON example agents actually read (SKILL.md)
 * must validate against the canonical schema. Drift cannot merge.
 *
 * Credential canary: a unique secret goes in via the store; it must never
 * appear in CLI stdout/stderr, the audit log, or (encrypted path) the store
 * file. This is the CI-provable slice of "the AI never sees your credentials".
 */

describe('SKILL.md contract drift gate', () => {
  it('the embedded Graph JSON example validates against graph.schema.json', async () => {
    const skill = readFileSync('SKILL.md', 'utf8');
    const blocks = [...skill.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]!);
    const graphBlock = blocks.find((b) => b.includes('"version": 1') && b.includes('"nodes"'));
    expect(graphBlock, 'SKILL.md must contain a Graph JSON example').toBeDefined();
    const doc = await validateGraphDocument(graphBlock!);
    expect(doc.edges[0]).toHaveProperty('receipt');
  });

  it('the hand-written fixture also passes (both sources track the schema)', async () => {
    await validateGraphDocument(readFileSync('fixtures/flagship-graph.json', 'utf8'));
  });
});

describe('credential canary', () => {
  const HOME = mkdtempSync(path.join(tmpdir(), 'oq-canary-'));
  const CANARY = 'CANARY_hunter9_XYZZY_do_not_leak';
  const CONN = `postgres://alice:${CANARY}@nonexistent-host.invalid:5432/prod`;

  afterAll(() => rmSync(HOME, { recursive: true, force: true }));

  function cli(args: string[]) {
    return spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/cli/index.ts', ...args], {
      env: { ...process.env, OPENQUERY_HOME: HOME },
      encoding: 'utf8',
      timeout: 120_000,
    });
  }

  it('the canary never surfaces in CLI output, audit log, or (DPAPI) store file', async () => {
    process.env.OPENQUERY_HOME = HOME;
    const { saveConnection, resolveConnection } = await import('../src/config/store.js');
    const saved = await saveConnection('canarydb', CONN);

    // In-process roundtrip works (the CLI itself must be able to read it back).
    const resolved = await resolveConnection('canarydb');
    expect(resolved.kind === 'postgres' && resolved.connectionString).toBe(CONN);

    // Store file: with DPAPI the literal must be absent; without it, file perms
    // are the (documented) protection — base64 still defeats a literal grep.
    const storeRaw = readFileSync(path.join(HOME, 'connections.json'), 'utf8');
    expect(storeRaw).not.toContain(CANARY);
    if (process.platform === 'win32') expect(saved.encrypted).toBe(true);

    // Failed connection attempt: no canary in either stream.
    const result = cli(['query', 'canarydb', '--sql', 'SELECT 1']);
    expect(result.status).toBe(1);
    expect(result.stdout ?? '').not.toContain(CANARY);
    expect(result.stderr ?? '').not.toContain(CANARY);

    // Audit log (if written): no canary.
    const auditPath = path.join(HOME, 'audit.jsonl');
    if (existsSync(auditPath)) {
      expect(readFileSync(auditPath, 'utf8')).not.toContain(CANARY);
    }

    delete process.env.OPENQUERY_HOME;
  }, 180_000);
});
