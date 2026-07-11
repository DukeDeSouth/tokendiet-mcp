import { spawn } from 'node:child_process';
import { envForSubprocess } from '../nodeEnv.js';
import type { SearchCollectResult, SearchMatch } from './types.js';

export const SEARCH_MATCH_CAP = 5000;

interface RgJsonMatch {
  type: string;
  data?: {
    path?: { text?: string };
    line_number?: number;
    lines?: { text?: string };
  };
}

export function searchWithRg(
  workspace: string,
  query: string,
  glob?: string,
): Promise<SearchCollectResult | null> {
  return new Promise((resolve) => {
    const args = ['--json', '-e', query, '--no-config'];
    if (glob) args.push('--glob', glob);
    args.push('.');

    const child = spawn('rg', args, {
      cwd: workspace,
      env: envForSubprocess(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    child.stdout?.on('data', (c: Buffer) => {
      stdout += c.toString('utf8');
    });

    child.on('error', () => resolve(null));

    child.on('close', (code) => {
      if (code !== 0 && code !== 1) {
        resolve(null);
        return;
      }
      const matches: SearchMatch[] = [];
      let truncated = false;
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line) as RgJsonMatch;
          if (row.type !== 'match' || !row.data?.path?.text) continue;
          const text = (row.data.lines?.text ?? '').replace(/\n$/, '');
          matches.push({
            path: row.data.path.text.replace(/^\.\//, ''),
            line: row.data.line_number ?? 0,
            text,
          });
          if (matches.length >= SEARCH_MATCH_CAP) {
            truncated = true;
            break;
          }
        } catch {
          // skip malformed json line
        }
      }
      resolve({ matches, backend: 'rg', truncated });
    });
  });
}
