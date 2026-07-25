import { functionBodySource } from '../outlinePlus.js';
import { countTokens } from '../../tokenize/counter.js';
import type { Encoding } from '../../types.js';
import type { CodeOutlineMode, OutlineItem } from './types.js';
import type { AnnotationExtraction } from '../annotations.js';

const OUTLINE_HINT =
  'hint: expand(ref) for full file, read(mode=symbol, symbol="Name") for a single definition';

const OUTLINE_PLUS_HINT =
  'hint: use read(mode=full) if editing function bodies; read(mode=symbol, symbol="Name") for one definition';

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function displaySignature(item: OutlineItem): string {
  const sig = oneLine(item.signature);
  if (item.exported && !sig.startsWith('export ')) {
    return `export ${sig}`;
  }
  return sig;
}

function formatItem(item: OutlineItem, mode: CodeOutlineMode): string {
  const range = `[${item.startLine}–${item.endLine}]`;
  const sig = displaySignature(item);
  if (mode === 'signatures' && item.doc) {
    return `${item.doc}\n${sig} ${range}`;
  }
  return `${sig} ${range}`;
}

/** Render imports + outline items for outline/signatures modes. */
export function renderOutline(
  imports: string[],
  items: OutlineItem[],
  mode: Exclude<CodeOutlineMode, 'symbol' | 'outline_plus'>,
): string {
  const lines: string[] = [];
  if (imports.length > 0) {
    lines.push('# imports');
    lines.push(`import: ${imports.join(', ')}`);
    lines.push('');
  }
  lines.push(`# ${mode}`);
  for (const item of items) {
    lines.push(formatItem(item, mode));
  }
  lines.push('');
  lines.push(OUTLINE_HINT);
  return lines.join('\n');
}

function formatAnnotationLines(blocks: { lines: string[] }[], indent = ''): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    for (const line of block.lines) {
      out.push(`${indent}${line.trim()}`);
    }
  }
  return out;
}

/** outline+ — signatures, top-level bindings, and small function bodies within per-file budget. */
export function renderOutlinePlus(
  source: string,
  imports: string[],
  items: OutlineItem[],
  topLevelBindings: OutlineItem[],
  encoding: Encoding,
  bodyBudget: number,
  annotations?: AnnotationExtraction,
): string {
  const lines: string[] = [];

  if (annotations && annotations.fileLevel.length > 0) {
    lines.push('# file-warnings');
    lines.push(...formatAnnotationLines(annotations.fileLevel));
    lines.push('');
  }

  if (imports.length > 0) {
    lines.push('# imports');
    lines.push(`import: ${imports.join(', ')}`);
    lines.push('');
  }

  if (topLevelBindings.length > 0) {
    lines.push('# top-level');
    for (const binding of topLevelBindings) {
      lines.push(binding.signature);
    }
    lines.push('');
  }

  lines.push('# outline_plus');
  let bodyBudgetRemaining = bodyBudget;
  for (const item of items) {
    const symBlocks = annotations?.bySymbol.get(item.name);
    if (symBlocks?.length) {
      lines.push(...formatAnnotationLines(symBlocks, '  '));
    }
    const range = `[${item.startLine}–${item.endLine}]`;
    const sig = displaySignature(item);
    lines.push(`${sig} ${range}`);
    const body = functionBodySource(source, item);
    if (body && bodyBudgetRemaining > 0) {
      const bodyTokens = countTokens(body, encoding);
      if (bodyTokens <= bodyBudgetRemaining) {
        for (const line of body.split('\n')) {
          lines.push(`  ${line}`);
        }
        bodyBudgetRemaining -= bodyTokens;
      }
    }
  }

  lines.push('');
  lines.push(OUTLINE_PLUS_HINT);
  return lines.join('\n');
}

/** Outline/signatures with security-critical comment blocks injected. */
export function renderOutlineWithAnnotations(
  imports: string[],
  items: OutlineItem[],
  mode: Exclude<CodeOutlineMode, 'symbol' | 'outline_plus'>,
  extraction: AnnotationExtraction,
): string {
  const lines: string[] = [];

  if (extraction.fileLevel.length > 0) {
    lines.push('# file-warnings');
    lines.push(...formatAnnotationLines(extraction.fileLevel));
    lines.push('');
  }

  if (imports.length > 0) {
    lines.push('# imports');
    lines.push(`import: ${imports.join(', ')}`);
    lines.push('');
  }

  lines.push(`# ${mode}`);
  for (const item of items) {
    const range = `[${item.startLine}–${item.endLine}]`;
    const sig = displaySignature(item);
    if (mode === 'signatures' && item.doc) {
      lines.push(item.doc);
      lines.push(`${sig} ${range}`);
    } else {
      lines.push(`${sig} ${range}`);
    }
    const symBlocks = extraction.bySymbol.get(item.name);
    if (symBlocks?.length) {
      lines.push(...formatAnnotationLines(symBlocks, '  '));
    }
  }

  lines.push('');
  lines.push(OUTLINE_HINT);
  return lines.join('\n');
}
