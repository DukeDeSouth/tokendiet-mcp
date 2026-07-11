/**
 * SF v3: search + fetch workload (5 queries + 3 URLs).
 * Run: npm run dogfood:sf  (requires network)
 */
import { benchFetch, benchSearch, makeBenchContext, summarize, workspaceRoot } from './dogfood-lib.js';

const SEARCHES: Array<{ query: string; glob?: string; label: string }> = [
  { query: 'handleRead', glob: '**/*.ts', label: 'search handleRead in ts' },
  { query: 'verifyHtml|verifySearch', glob: 'src/**/*.ts', label: 'search verify helpers' },
  { query: 'export function', glob: '*.ts', label: 'search exports basename glob' },
  { query: 'export function', glob: 'src/tools/*.ts', label: 'search exports in tools' },
  { query: 'extractCodeView|extractDeclarations', label: 'search AST extractors' },
  { query: 'recordStat', glob: 'src/**/*.ts', label: 'search recordStat' },
];

const FETCHES: Array<{ url: string; label: string }> = [
  {
    url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify',
    label: 'fetch MDN JSON.stringify',
  },
  {
    url: 'https://api.github.com/repos/nodejs/node',
    label: 'fetch GitHub API nodejs/node',
  },
  {
    url: 'https://raw.githubusercontent.com/fb55/htmlparser2/master/README.md',
    label: 'fetch htmlparser2 README',
  },
];

async function main() {
  const ctx = makeBenchContext(workspaceRoot());
  const ops = [];

  for (const s of SEARCHES) {
    ops.push(await benchSearch(ctx, s.query, s.label, s.glob));
  }
  for (const f of FETCHES) {
    ops.push(await benchFetch(ctx, f.url, f.label));
  }

  const result = summarize('SF-search-fetch-v3', ops, ctx);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
