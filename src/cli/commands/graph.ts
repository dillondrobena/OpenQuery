import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv, type ValidateFunction } from 'ajv';
import { CliError } from '../errors.js';
import { openInBrowser, serveGraph } from '../../viewer/server.js';

/*
 * graph --input g.json — validate against Graph JSON v1 (schema + size bounds),
 * then serve the evidence explorer. Bounds: warn past 500 nodes, refuse past
 * 5000 (force layout is ~O(n²); human-readable graphs are hundreds of nodes).
 */

const WARN_NODES = 500;
const AGGREGATION_HINT =
  'Aggregate before rendering: group minor rows into one weighted edge (e.g. sum small transactions), or filter to the entities the question actually asks about.';

let compiled: ValidateFunction | null = null;

async function graphValidator(): Promise<ValidateFunction> {
  if (compiled) return compiled;
  const schemaPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..', '..', '..', 'schema', 'graph.schema.json'
  );
  const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8')) as object;
  const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
  ajv.addFormat('date-time', true);
  compiled = ajv.compile(schema);
  return compiled;
}

export interface GraphDocument {
  version: 1;
  question: string;
  connection?: string;
  nodes: Array<{ id: string; label: string }>;
  edges: Array<{ id: string; source: string; target: string }>;
}

export async function validateGraphDocument(raw: string): Promise<GraphDocument> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CliError(
      'VIEWER_ERROR',
      `graph input is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const validate = await graphValidator();
  if (!validate(parsed)) {
    const first = validate.errors?.[0];
    throw new CliError(
      'VIEWER_ERROR',
      `graph input failed Graph JSON v1 validation: ${first?.instancePath ?? ''} ${first?.message ?? 'invalid'}`,
      first?.keyword === 'maxItems'
        ? AGGREGATION_HINT
        : 'See schema/graph.schema.json — every edge needs a receipt {sql, params, rowCount}.'
    );
  }

  const doc = parsed as GraphDocument;

  // Referential integrity: every edge endpoint must be a declared node.
  const nodeIds = new Set(doc.nodes.map((n) => n.id));
  for (const edge of doc.edges) {
    for (const endpoint of [edge.source, edge.target]) {
      if (!nodeIds.has(endpoint)) {
        throw new CliError(
          'VIEWER_ERROR',
          `edge '${edge.id}' references unknown node '${endpoint}'`,
          'Every edge source/target must match a node id.'
        );
      }
    }
  }

  if (doc.nodes.length > WARN_NODES) {
    process.stderr.write(
      `WARNING: ${doc.nodes.length} nodes — graphs over ${WARN_NODES} get hard to read and slow to lay out. ${AGGREGATION_HINT}\n`
    );
  }
  return doc;
}

export interface GraphCommandOptions {
  input: string;
  wait: boolean;
}

export async function graphCommand(
  opts: GraphCommandOptions,
  registerCleanup: (fn: () => Promise<void>) => void
): Promise<void> {
  const raw = await fs.readFile(opts.input, 'utf8').catch((err) => {
    throw new CliError('VIEWER_ERROR', `could not read ${opts.input}: ${err.message}`);
  });
  const doc = await validateGraphDocument(raw);
  const summary = `${doc.nodes.length} nodes, ${doc.edges.length} edges. Graph is agent-asserted (v1); receipts show the SQL behind each edge.\n`;

  if (opts.wait) {
    const served = await serveGraph(doc);
    registerCleanup(served.close);
    process.stdout.write(`Evidence explorer: ${served.url}\n${summary}Serving until Ctrl+C.\n`);
    openInBrowser(served.url);
    await new Promise(() => {}); // SIGINT handler closes the server
  } else {
    // --no-wait: exactly ONE server and ONE URL — the detached child's.
    // (Dogfooding found the old serve-close-respawn flow printed two URLs,
    // the first of them dead.)
    const { spawn } = await import('node:child_process');
    const self = fileURLToPath(import.meta.url);
    const cliEntry = path.resolve(path.dirname(self), '..', 'index.js');
    const child = spawn(process.execPath, [cliEntry, '__serve', path.resolve(opts.input)], {
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const url: string = await new Promise((resolve) => {
      let buffer = '';
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const line = buffer.split('\n')[0];
        if (line && line.startsWith('http')) resolve(line.trim());
      });
      setTimeout(() => resolve(''), 10_000);
    });
    child.unref();
    if (url) {
      process.stdout.write(`Evidence explorer (detached): ${url}\n${summary}`);
      openInBrowser(url);
    } else {
      throw new CliError('VIEWER_ERROR', 'detached viewer did not report a URL within 10s');
    }
  }
}

/** Hidden `__serve` subcommand: the detached child behind --no-wait. */
export async function serveDetached(inputPath: string): Promise<void> {
  const raw = await fs.readFile(inputPath, 'utf8');
  const doc = await validateGraphDocument(raw);
  const served = await serveGraph(doc);
  process.stdout.write(`${served.url}\n`);
  await new Promise(() => {});
}
