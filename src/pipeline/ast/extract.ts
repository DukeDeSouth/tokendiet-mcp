import type { AstLanguage } from './lang.js';
import { astLanguageForExtension } from './lang.js';
import { extractPythonDeclarations } from './lang/python.js';
import { extractTypeScriptDeclarations } from './lang/typescript.js';
import { withParsedTree } from './parser.js';
import { renderOutline, renderOutlineWithAnnotations } from './render.js';
import { findOutlineItem } from './symbols.js';
import type { CodeOutlineMode, ExtractionResult } from './types.js';
import type { AnnotationExtraction } from '../annotations.js';

export type { CodeOutlineMode, ExtractionResult, OutlineItem } from './types.js';
export { astLanguageForExtension } from './lang.js';
export { findOutlineItem } from './symbols.js';

export function isTypescriptLanguage(language: AstLanguage): boolean {
  return language === 'typescript' || language === 'tsx';
}

export function isPythonLanguage(language: AstLanguage): boolean {
  return language === 'python';
}

/** Extract structured declarations (TS/TSX/Python). */
export async function extractDeclarations(
  language: AstLanguage,
  source: string,
): Promise<ExtractionResult> {
  if (isTypescriptLanguage(language)) {
    return withParsedTree(language, source, (root, src) => extractTypeScriptDeclarations(root, src));
  }
  if (isPythonLanguage(language)) {
    return withParsedTree(language, source, (root, src) => extractPythonDeclarations(root, src));
  }
  throw new Error(`AST extraction not implemented for ${language}`);
}

/** Render outline/signatures/symbol view from a prior extraction result. */
export function renderCodeViewFromExtraction(
  source: string,
  extracted: ExtractionResult,
  mode: CodeOutlineMode,
  symbol?: string,
  annotations?: AnnotationExtraction,
): string {
  const { imports, items } = extracted;

  if (mode === 'symbol') {
    if (!symbol?.trim()) {
      throw new Error('symbol is required for mode=symbol');
    }
    const item = findOutlineItem(items, symbol.trim());
    if (!item) {
      throw new Error(`symbol not found: ${symbol}`);
    }
    return source.slice(item.startIndex, item.endIndex);
  }

  if (annotations && annotations.critical.length > 0) {
    return renderOutlineWithAnnotations(imports, items, mode, annotations);
  }

  return renderOutline(imports, items, mode);
}

/** Render outline, signatures, or a single symbol body from source. */
export async function extractCodeView(
  language: AstLanguage,
  source: string,
  mode: CodeOutlineMode,
  symbol?: string,
): Promise<string> {
  const extracted = await extractDeclarations(language, source);
  return renderCodeViewFromExtraction(source, extracted, mode, symbol);
}

/** Resolve language from file extension for extraction. */
export function languageForPath(path: string): AstLanguage | undefined {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return undefined;
  return astLanguageForExtension(path.slice(dot + 1));
}
