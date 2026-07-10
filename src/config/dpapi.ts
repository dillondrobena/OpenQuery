import { spawnSync } from 'node:child_process';

/*
 * Windows DPAPI (user scope) via a PowerShell subprocess — zero native npm
 * bindings in v1. The secret transits ONLY the child's environment, never the
 * command line (argv is visible to other processes; env of your own child is not).
 *
 * Failure path (locked-down PowerShell, constrained language mode, missing
 * assembly): callers fall back to plaintext-file storage and MUST print a
 * warning naming the reduced protection — never fail silently into weaker mode.
 */

function runPs(script: string, secretEnv: string): string | null {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { env: { ...process.env, OQ_SECRET: secretEnv }, encoding: 'utf8', timeout: 15_000 }
  );
  if (result.status !== 0 || result.error) return null;
  const out = result.stdout.trim();
  return out.length > 0 ? out : null;
}

export function dpapiProtect(plaintext: string): string | null {
  if (process.platform !== 'win32') return null;
  return runPs(
    `Add-Type -AssemblyName System.Security; ` +
      `[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect(` +
      `[Text.Encoding]::UTF8.GetBytes($env:OQ_SECRET), $null, 'CurrentUser'))`,
    plaintext
  );
}

export function dpapiUnprotect(base64: string): string | null {
  if (process.platform !== 'win32') return null;
  return runPs(
    `Add-Type -AssemblyName System.Security; ` +
      `[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect(` +
      `[Convert]::FromBase64String($env:OQ_SECRET), $null, 'CurrentUser'))`,
    base64
  );
}
