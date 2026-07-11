import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readTemplate(name: string): string {
  return readFileSync(join(PKG_ROOT, 'templates', name), 'utf8');
}

function mergeMcpJson(projectRoot: string, serverEntry: string): void {
  const mcpPath = join(projectRoot, '.cursor', 'mcp.json');
  mkdirSync(dirname(mcpPath), { recursive: true });
  let config: { mcpServers?: Record<string, unknown> } = {};
  if (existsSync(mcpPath)) {
    config = JSON.parse(readFileSync(mcpPath, 'utf8')) as typeof config;
  }
  config.mcpServers ??= {};
  config.mcpServers.tokendiet = {
    command: process.execPath,
    args: [serverEntry],
    env: {
      TOKENDIET_WORKSPACE: projectRoot,
    },
  };
  writeFileSync(mcpPath, `${JSON.stringify(config, null, 2)}\n`);
}

export function runCursorSetup(projectRoot: string): void {
  const root = resolve(projectRoot);
  const serverEntry = join(PKG_ROOT, 'dist', 'index.js');
  mergeMcpJson(root, serverEntry);

  const rulesPath = join(root, '.cursor', 'rules', 'tokendiet.mdc');
  mkdirSync(dirname(rulesPath), { recursive: true });
  writeFileSync(rulesPath, readTemplate('tokendiet.mdc'));

  process.stdout.write(
    `TokenDiet setup complete for Cursor.\n- ${join(root, '.cursor', 'mcp.json')}\n- ${rulesPath}\nRestart Cursor or reload MCP servers.\n`,
  );
}

export function runSetup(argv: string[]): void {
  const clientIdx = argv.indexOf('--client');
  const client = clientIdx >= 0 ? argv[clientIdx + 1] : 'cursor';
  const projectIdx = argv.indexOf('--project');
  const projectRoot = projectIdx >= 0 ? argv[projectIdx + 1]! : process.cwd();

  if (client !== 'cursor') {
    process.stderr.write(`Only --client cursor is supported in Sprint 1.\n`);
    process.exit(1);
  }
  runCursorSetup(projectRoot);
}
