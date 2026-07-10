import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError } from '../cli/errors.js';

/*
 * Evidence-explorer server: ephemeral, 127.0.0.1 only, random free port,
 * Jupyter-style URL token. Honest scope (README says the same): the token is a
 * local-process guard — once rows are in a browser, cache/extensions/devtools
 * are exposure surfaces the token cannot close.
 *
 *   GET /?token=T            viewer/index.html
 *   GET /app.js?token=T      viewer/app.js
 *   GET /app.css?token=T     viewer/app.css
 *   GET /force-graph.js?...  force-graph dist (served from node_modules)
 *   GET /graph.json?token=T  the validated Graph JSON
 *   anything else / no token 403 or 404
 */

const require = createRequire(import.meta.url);

function viewerAssetDir(): string {
  // dist/viewer/server.js -> ../../viewer ; src/viewer/server.ts (tsx) -> same
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'viewer');
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

export interface ServedGraph {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export async function serveGraph(graph: unknown): Promise<ServedGraph> {
  const token = crypto.randomBytes(24).toString('base64url');
  const graphBody = JSON.stringify(graph);
  const assetDir = viewerAssetDir();

  let forceGraphPath: string;
  try {
    // The package's exports map blocks subpath resolution — resolve the main
    // entry and take the minified sibling from the same dist directory.
    const main = require.resolve('force-graph');
    const min = path.join(path.dirname(main), 'force-graph.min.js');
    forceGraphPath = min;
    await fs.access(min).catch(() => {
      forceGraphPath = main;
    });
  } catch {
    throw new CliError(
      'VIEWER_ERROR',
      'could not locate the force-graph library',
      'Reinstall dependencies: npm install'
    );
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.searchParams.get('token') !== token) {
        res.writeHead(403, { 'content-type': 'text/plain' });
        res.end('403 — missing or invalid token. Use the exact URL openquery printed.');
        return;
      }

      const routes: Record<string, () => Promise<[string, string | Buffer]>> = {
        '/': async () => {
          // Asset tags need the token too — inject it so every request is gated.
          const html = (await fs.readFile(path.join(assetDir, 'index.html'), 'utf8')).replace(
            /(href|src)="(app\.css|app\.js|force-graph\.js)"/g,
            `$1="$2?token=${token}"`
          );
          return ['.html', html];
        },
        '/app.js': async () => ['.js', await fs.readFile(path.join(assetDir, 'app.js'))],
        '/app.css': async () => ['.css', await fs.readFile(path.join(assetDir, 'app.css'))],
        '/force-graph.js': async () => ['.js', await fs.readFile(forceGraphPath)],
        '/graph.json': async () => ['.json', graphBody],
      };

      const handler = routes[url.pathname];
      if (!handler) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('404');
        return;
      }
      try {
        const [ext, body] = await handler();
        res.writeHead(200, {
          'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
          'cache-control': 'no-store', // ephemeral server, live-read assets
        });
        res.end(body);
      } catch (err) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end(`500 — ${err instanceof Error ? err.message : 'internal error'}`);
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new CliError('VIEWER_ERROR', 'could not determine viewer port');
  }

  return {
    url: `http://127.0.0.1:${address.port}/?token=${token}`,
    port: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

/** Best-effort browser open; failure is fine — the URL is always printed. */
export function openInBrowser(url: string): void {
  void (async () => {
    const { spawn } = await import('node:child_process');
    const [cmd, args] =
      process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : process.platform === 'darwin'
          ? ['open', [url]]
          : ['xdg-open', [url]];
    try {
      spawn(cmd, args as string[], { stdio: 'ignore', detached: true }).unref();
    } catch {
      /* URL is printed; nothing else to do */
    }
  })();
}
