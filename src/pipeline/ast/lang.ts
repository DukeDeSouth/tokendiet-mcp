/** WASM grammar loaded by web-tree-sitter. */
export type AstLanguage = 'typescript' | 'tsx' | 'python';

const EXT_TO_LANG: Record<string, AstLanguage> = {
  ts: 'typescript',
  js: 'typescript',
  mjs: 'typescript',
  cjs: 'typescript',
  tsx: 'tsx',
  jsx: 'tsx',
  py: 'python',
};

/** Map file extension (with or without dot) to AST language, if supported in v1. */
export function astLanguageForExtension(ext: string): AstLanguage | undefined {
  return EXT_TO_LANG[ext.toLowerCase().replace(/^\./, '')];
}
