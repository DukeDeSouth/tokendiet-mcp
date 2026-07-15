/**
 * R6: security-aware outline — sendPayment fixture with SECURITY/TODO/URL.
 * Run: npm run dogfood:r6
 */
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createContext } from '../src/context.js';
import { Storage } from '../src/storage/sqlite.js';
import { RefStore } from '../src/storage/refStore.js';
import { handleRead } from '../src/tools/read.js';
import { countTokens } from '../src/tokenize/counter.js';

const FIXTURE = `// SECURITY: never call without owner approval
// TODO: leaks API key to logs
export async function sendPayment(amount: number) {
  const url = 'https://internal-broker.local/pay';
  return amount;
}
${Array.from({ length: 45 }, (_, i) => `export function pad${i}(n: number) { return n + ${i}; }`).join('\n')}
`;

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'td-r6-'));
  const file = join(dir, 'payments.ts');
  writeFileSync(file, FIXTURE);

  const ctx = createContext({
    workspace: dir,
    storage: new Storage(':memory:'),
    refStore: new RefStore(join(dir, '.td')),
    codeOutlineThreshold: 50,
    smallFileTokenThreshold: 10,
  });

  const tokensIn = countTokens(FIXTURE, ctx.encoding);
  const res = await handleRead(ctx, { path: 'payments.ts', mode: 'auto' });

  if (res.status !== 'compressed') {
    console.error('expected compressed, got', res.status);
    process.exit(1);
  }

  const content = res.content;
  const checks = [
    ['SECURITY', content.includes('SECURITY')],
    ['TODO', content.includes('TODO')],
    ['sendPayment', content.includes('sendPayment')],
    ['annotations_included', res.annotations_included === true || res.annotations_included === 'partial'],
    ['warnings', Array.isArray(res.warnings) && res.warnings.length > 0],
    ['resolved_from auto', res.resolved_from === 'auto'],
    ['verified structure', res.verified === true],
  ] as const;

  const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length) {
    console.error('R6 FAILED:', failed.join(', '));
    console.error(content.slice(0, 500));
    rmSync(dir, { recursive: true, force: true });
    process.exit(1);
  }

  const result = {
    scenario: 'R6-security-outline',
    baseline_tokens: tokensIn,
    compressed_tokens: res.compression.tokens_out,
    saved_tokens: res.compression.saved,
    saved_pct: res.compression.saved_pct,
    checks: Object.fromEntries(checks.map(([k, v]) => [k, v])),
  };

  console.log(JSON.stringify(result, null, 2));
  rmSync(dir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
