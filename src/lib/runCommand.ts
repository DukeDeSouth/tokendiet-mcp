import { spawn } from 'node:child_process';
import { envForSubprocess } from './nodeEnv.js';

export const RUN_TIMEOUT_MS = 120_000;
export const RUN_OUTPUT_CAP_BYTES = 10 * 1024 * 1024;

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
}

export function runCommand(command: string, cwd: string): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: envForSubprocess(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;

    const append = (chunk: Buffer, target: 'stdout' | 'stderr') => {
      const text = chunk.toString('utf8');
      const current = target === 'stdout' ? stdout : stderr;
      const combinedLen = Buffer.byteLength(stdout + stderr, 'utf8');
      if (combinedLen >= RUN_OUTPUT_CAP_BYTES) {
        truncated = true;
        return;
      }
      const room = RUN_OUTPUT_CAP_BYTES - combinedLen;
      const slice = text.slice(0, room);
      if (target === 'stdout') stdout += slice;
      else stderr += slice;
      if (slice.length < text.length) truncated = true;
    };

    child.stdout?.on('data', (c: Buffer) => append(c, 'stdout'));
    child.stderr?.on('data', (c: Buffer) => append(c, 'stderr'));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000).unref();
    }, RUN_TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, exitCode: code, timedOut, truncated });
    });
  });
}
