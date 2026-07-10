import readline from 'node:readline';
import { CliError } from './errors.js';

/*
 * The credential prompt. Structural guarantee: this is the ONLY path a
 * connection string can enter OpenQuery — no argument, no env var, no stdin
 * pipe. TTY required, so an agent shelling `connect` gets a refusal that tells
 * the human to run it themselves.
 */

export function requireInteractiveTty(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError(
      'CONNECT_FAILED',
      'connect requires an interactive terminal — it looks like this was run by a program, not a person',
      'Run this yourself in your own terminal: openquery connect <alias>. The AI never sees the connection string.'
    );
  }
}

/** Read a line with echo suppressed (input hidden like a password prompt). */
export function promptHidden(promptText: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const write = (rl as unknown as { _writeToOutput?: (s: string) => void });
    process.stdout.write(promptText);
    write._writeToOutput = () => {}; // suppress echo
    rl.question('', (answer) => {
      write._writeToOutput = undefined;
      process.stdout.write('\n');
      rl.close();
      resolve(answer.trim());
    });
  });
}
