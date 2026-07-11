import type { CodeOutlineMode, OutlineItem } from './types.js';

const OUTLINE_HINT =
  'hint: expand(ref) for full file, read(mode=symbol, symbol="Name") for a single definition';

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
  mode: Exclude<CodeOutlineMode, 'symbol'>,
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
