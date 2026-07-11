#!/usr/bin/env node
/**
 * Copy tree-sitter WASM artifacts into package wasm/ for runtime loading.
 */
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'wasm');
mkdirSync(dest, { recursive: true });

const copies = [
  ['node_modules/web-tree-sitter/web-tree-sitter.wasm', 'web-tree-sitter.wasm'],
  ['node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm', 'tree-sitter-typescript.wasm'],
  ['node_modules/tree-sitter-typescript/tree-sitter-tsx.wasm', 'tree-sitter-tsx.wasm'],
  ['node_modules/tree-sitter-python/tree-sitter-python.wasm', 'tree-sitter-python.wasm'],
];

for (const [src, name] of copies) {
  cpSync(join(root, src), join(dest, name));
}
