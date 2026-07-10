import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateGraphDocument } from '../src/cli/commands/graph.js';
import { serveGraph } from '../src/viewer/server.js';
import { CliError } from '../src/cli/errors.js';
import { dpapiProtect, dpapiUnprotect } from '../src/config/dpapi.js';
import { appendAudit } from '../src/audit.js';

const fixture = readFileSync('fixtures/flagship-graph.json', 'utf8');

describe('graph validation', () => {
  it('the hand-written flagship fixture validates', async () => {
    const doc = await validateGraphDocument(fixture);
    expect(doc.nodes).toHaveLength(4);
    expect(doc.edges).toHaveLength(3);
  });

  it('rejects malformed JSON, naming the problem', async () => {
    await expect(validateGraphDocument('{nope')).rejects.toThrow(/not valid JSON/);
  });

  it('rejects a missing receipt (every edge needs its proof)', async () => {
    const doc = JSON.parse(fixture);
    delete doc.edges[0].receipt;
    await expect(validateGraphDocument(JSON.stringify(doc))).rejects.toThrow(/validation/);
  });

  it('rejects an edge pointing at an undeclared node', async () => {
    const doc = JSON.parse(fixture);
    doc.edges[0].target = 'company:missing';
    await expect(validateGraphDocument(JSON.stringify(doc))).rejects.toThrow(/unknown node/);
  });

  it('refuses graphs past the 5000-node bound with an aggregation hint', async () => {
    const doc = JSON.parse(fixture);
    doc.nodes = Array.from({ length: 5001 }, (_, i) => ({ id: `n:${i}`, label: `n${i}` }));
    doc.edges = [];
    try {
      await validateGraphDocument(JSON.stringify(doc));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).hint).toMatch(/Aggregate/);
    }
  });
});

describe('viewer server (token gate)', () => {
  it('serves the graph with the token and 403s without it', async () => {
    const served = await serveGraph(JSON.parse(fixture));
    try {
      const ok = await fetch(served.url.replace('/?token=', '/graph.json?token='));
      expect(ok.status).toBe(200);
      const doc = await ok.json();
      expect(doc.question).toMatch(/user 42/);

      const noToken = await fetch(`http://127.0.0.1:${served.port}/graph.json`);
      expect(noToken.status).toBe(403);
      const badToken = await fetch(`http://127.0.0.1:${served.port}/?token=wrong`);
      expect(badToken.status).toBe(403);

      const html = await fetch(served.url);
      expect(html.status).toBe(200);
      expect(await html.text()).toContain('agent-asserted (v1)');

      const lib = await fetch(`http://127.0.0.1:${served.port}/force-graph.js?token=${served.url.split('token=')[1]}`);
      expect(lib.status).toBe(200);
    } finally {
      await served.close();
    }
  });
});

describe('credential encryption (DPAPI, Windows only)', () => {
  it.skipIf(process.platform !== 'win32')('roundtrips through DPAPI without the secret in argv', () => {
    const secret = 'postgres://user:hunter2@db.internal:5432/prod';
    const protectedValue = dpapiProtect(secret);
    expect(protectedValue).toBeTruthy();
    expect(protectedValue).not.toContain('hunter2');
    expect(dpapiUnprotect(protectedValue!)).toBe(secret);
  }, 60_000);
});

describe('audit warn-and-continue', () => {
  it('never throws even when the audit dir is unwritable', async () => {
    const prev = process.env.OPENQUERY_HOME;
    // A path under an existing FILE cannot be mkdir'd — guaranteed write failure.
    process.env.OPENQUERY_HOME = `${process.cwd()}/package.json/impossible`;
    try {
      await expect(
        appendAudit({ ts: 't', alias: 'a', sql: 's', params: [], rowCount: 0, durationMs: 0, status: 'ok' })
      ).resolves.toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.OPENQUERY_HOME;
      else process.env.OPENQUERY_HOME = prev;
    }
  });
});
