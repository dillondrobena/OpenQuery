import { promises as fs } from 'node:fs';

/*
 * Advisory lockfile for PGlite data dirs (strictly single-connection engine,
 * but agents fire parallel CLI invocations). Lock = a file containing the
 * holder's PID. Stale locks (dead PID) are reclaimed so a crashed invocation
 * can never wedge the demo.
 */

const POLL_MS = 100;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'; // alive, not ours
  }
}

export class LockTimeoutError extends Error {
  readonly code = 'TIMEOUT';
  constructor(lockPath: string, waitedMs: number) {
    super(
      `could not acquire lock ${lockPath} after ${waitedMs}ms — another openquery invocation holds it. Retry, or delete the file if no other invocation is running.`
    );
  }
}

export async function acquireLock(lockPath: string, timeoutMs = 15_000): Promise<() => Promise<void>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      await handle.writeFile(String(process.pid), 'utf8');
      await handle.close();
      return async () => {
        await fs.rm(lockPath, { force: true });
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }

    // Lock exists: reclaim if the holder is dead.
    try {
      const holder = Number.parseInt(await fs.readFile(lockPath, 'utf8'), 10);
      if (!Number.isInteger(holder) || !pidAlive(holder)) {
        await fs.rm(lockPath, { force: true });
        continue; // retry immediately
      }
    } catch {
      continue; // lock vanished between check and read — retry
    }

    if (Date.now() >= deadline) throw new LockTimeoutError(lockPath, timeoutMs);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
