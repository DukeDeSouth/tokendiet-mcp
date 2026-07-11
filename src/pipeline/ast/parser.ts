import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Language, Parser, type Node } from 'web-tree-sitter';
import type { AstLanguage } from './lang.js';

const WASM_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../wasm');

const WASM_FILES: Record<AstLanguage, string> = {
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  python: 'tree-sitter-python.wasm',
};

let initPromise: Promise<void> | null = null;
const parsers = new Map<AstLanguage, Parser>();

function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init({
      locateFile(scriptName: string) {
        return join(WASM_DIR, scriptName);
      },
    });
  }
  return initPromise;
}

async function getParser(language: AstLanguage): Promise<Parser> {
  await ensureInit();
  const cached = parsers.get(language);
  if (cached) return cached;

  const wasmPath = join(WASM_DIR, WASM_FILES[language]);
  const lang = await Language.load(wasmPath);
  const parser = new Parser();
  parser.setLanguage(lang);
  parsers.set(language, parser);
  return parser;
}

export interface AstParseResult {
  language: AstLanguage;
  rootType: string;
  namedChildCount: number;
  hasError: boolean;
}

/** Parse and run a callback with the syntax tree (tree freed after callback). */
export async function withParsedTree<T>(
  language: AstLanguage,
  source: string,
  fn: (root: Node, source: string) => T,
): Promise<T> {
  const parser = await getParser(language);
  const tree = parser.parse(source);
  if (!tree) {
    throw new Error(`tree-sitter parse returned null for ${language}`);
  }
  try {
    return fn(tree.rootNode, source);
  } finally {
    tree.delete();
  }
}

/** Parse source with lazy WASM grammar init (once per process per language). */
export async function parseSource(language: AstLanguage, source: string): Promise<AstParseResult> {
  return withParsedTree(language, source, (root) => ({
    language,
    rootType: root.type,
    namedChildCount: root.namedChildCount,
    hasError: root.hasError,
  }));
}

/** Test-only: reset lazy init and parser cache. */
export function resetAstParserForTests(): void {
  for (const parser of parsers.values()) {
    parser.delete();
  }
  parsers.clear();
  initPromise = null;
}
