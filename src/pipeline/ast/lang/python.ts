import type { Node } from 'web-tree-sitter';
import type { ExtractionResult, OutlineItem } from '../types.js';
import { lineRange, walkTree } from '../walk.js';

function importModule(node: Node, source: string): string {
  const text = source.slice(node.startIndex, node.endIndex).trim();
  if (node.type === 'import_from_statement') {
    const from = text.match(/^from\s+(\S+)\s+import\b/);
    if (from) return from[1]!;
  }
  if (node.type === 'import_statement') {
    const rest = text.match(/^import\s+(.+)$/);
    if (rest) {
      return rest[1]!
        .split(',')
        .map((part) => part.trim().split(/\s+as\s+/)[0]!.trim())
        .join(', ');
    }
  }
  return text.replace(/\s+/g, ' ').trim();
}

function signatureWithoutBody(node: Node, source: string): string {
  const body = node.childForFieldName('body');
  if (body) {
    return source.slice(node.startIndex, body.startIndex).trim();
  }
  return source.slice(node.startIndex, node.endIndex).trim();
}

function innerDefinition(node: Node): Node | undefined {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child?.type === 'function_definition' || child?.type === 'class_definition') {
      return child;
    }
  }
  return undefined;
}

function enclosingClass(node: Node): Node | undefined {
  let cur = node.parent;
  while (cur) {
    if (cur.type === 'class_definition') return cur;
    if (cur.type === 'function_definition' || cur.type === 'module') break;
    cur = cur.parent;
  }
  return undefined;
}

function pythonDocstring(node: Node, source: string): string | undefined {
  const body = node.childForFieldName('body');
  if (!body || body.namedChildCount === 0) return undefined;
  const first = body.namedChild(0);
  if (first?.type !== 'expression_statement') return undefined;
  const expr = first.namedChild(0);
  if (expr?.type === 'string') {
    return source.slice(expr.startIndex, expr.endIndex).trim();
  }
  return undefined;
}

function pushItem(
  items: OutlineItem[],
  node: Node,
  source: string,
  kind: OutlineItem['kind'],
  name: string,
  signature: string,
): void {
  const doc = pythonDocstring(node, source);
  items.push({
    kind,
    name,
    signature,
    ...(doc !== undefined && { doc }),
    ...lineRange(node),
    exported: false,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
  });
}

function collectFunction(node: Node, source: string, items: OutlineItem[]): void {
  const name = node.childForFieldName('name')?.text;
  if (!name) return;
  const cls = enclosingClass(node);
  pushItem(
    items,
    node,
    source,
    cls ? 'method' : 'function',
    name,
    signatureWithoutBody(node, source),
  );
}

function collectClass(node: Node, source: string, items: OutlineItem[]): void {
  const name = node.childForFieldName('name')?.text;
  if (!name) return;
  pushItem(items, node, source, 'class', name, signatureWithoutBody(node, source));
}

function collectDecorated(node: Node, source: string, items: OutlineItem[]): void {
  const inner = innerDefinition(node);
  if (!inner) return;
  const name = inner.childForFieldName('name')?.text;
  if (!name) return;
  const kind = inner.type === 'class_definition' ? 'class' : 'function';
  const body = inner.childForFieldName('body');
  const signature = body
    ? source.slice(node.startIndex, body.startIndex).trim()
    : source.slice(node.startIndex, node.endIndex).trim();
  const doc = pythonDocstring(inner, source);
  items.push({
    kind,
    name,
    signature,
    ...(doc !== undefined && { doc }),
    ...lineRange(node),
    exported: false,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
  });
}

function walkClassBody(classNode: Node, source: string, items: OutlineItem[]): void {
  const body = classNode.childForFieldName('body');
  if (!body) return;
  for (let i = 0; i < body.namedChildCount; i++) {
    const child = body.namedChild(i);
    if (!child) continue;
    if (child.type === 'function_definition') {
      collectFunction(child, source, items);
    } else if (child.type === 'decorated_definition') {
      collectDecorated(child, source, items);
    }
  }
}

function processModuleChild(node: Node, source: string, items: OutlineItem[]): void {
  switch (node.type) {
    case 'decorated_definition': {
      collectDecorated(node, source, items);
      const inner = innerDefinition(node);
      if (inner?.type === 'class_definition') {
        walkClassBody(inner, source, items);
      }
      break;
    }
    case 'class_definition':
      collectClass(node, source, items);
      walkClassBody(node, source, items);
      break;
    case 'function_definition':
      collectFunction(node, source, items);
      break;
  }
}

/** Extract imports + declaration outline from a Python tree-sitter tree. */
export function extractPythonDeclarations(root: Node, source: string): ExtractionResult {
  const imports: string[] = [];
  const items: OutlineItem[] = [];

  walkTree(root, (node) => {
    if (node.type === 'import_statement' || node.type === 'import_from_statement') {
      imports.push(importModule(node, source));
    }
  });

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i);
    if (child) processModuleChild(child, source, items);
  }

  return {
    imports: [...new Set(imports)],
    items,
  };
}
