import type { Node } from 'web-tree-sitter';
import type { ExtractionResult, OutlineItem, OutlineKind } from '../types.js';
import { leadingDoc, lineRange, walkTree } from '../walk.js';

const DECLARATION_TYPES = new Set([
  'function_declaration',
  'class_declaration',
  'method_definition',
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',
]);

function importModule(node: Node, source: string): string {
  const text = source.slice(node.startIndex, node.endIndex);
  const from = text.match(/\bfrom\s+['"]([^'"]+)['"]/);
  if (from) return from[1]!;
  const sideEffect = text.match(/import\s+['"]([^'"]+)['"]/);
  if (sideEffect) return sideEffect[1]!;
  return text.replace(/\s+/g, ' ').trim();
}

function signatureWithoutBody(node: Node, source: string): string {
  const body = node.childForFieldName('body');
  if (body) {
    return source.slice(node.startIndex, body.startIndex).trim();
  }
  return source.slice(node.startIndex, node.endIndex).trim();
}

function declaratorSignature(decl: Node, source: string): string {
  const value = decl.childForFieldName('value');
  if (value?.type === 'arrow_function') {
    const body = value.childForFieldName('body');
    if (body) {
      return source.slice(decl.startIndex, body.startIndex).trim();
    }
  }
  return source.slice(decl.startIndex, decl.endIndex).trim();
}

function nodeName(node: Node): string | undefined {
  const direct = node.childForFieldName('name');
  if (direct) return direct.text;
  if (node.type === 'lexical_declaration') {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === 'variable_declarator') {
        const name = child.childForFieldName('name');
        if (name) return name.text;
      }
    }
  }
  return undefined;
}

function kindForNode(node: Node): OutlineKind {
  switch (node.type) {
    case 'class_declaration':
      return 'class';
    case 'method_definition':
      return 'method';
    case 'interface_declaration':
      return 'interface';
    case 'type_alias_declaration':
      return 'type';
    case 'enum_declaration':
      return 'enum';
    case 'lexical_declaration':
      return 'variable';
    default:
      return 'function';
  }
}

function pushTopLevelBinding(
  node: Node,
  source: string,
  exported: boolean,
  name: string,
  kind: OutlineKind,
  bindings: OutlineItem[],
): void {
  const range = lineRange(node);
  let signature = source.slice(node.startIndex, node.endIndex).trim();
  if (exported && !signature.startsWith('export ')) {
    signature = `export ${signature}`;
  }
  bindings.push({
    kind,
    name,
    signature,
    ...range,
    exported,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
  });
}

function collectDeclaration(
  node: Node,
  source: string,
  exported: boolean,
  items: OutlineItem[],
  topLevelBindings: OutlineItem[],
): void {
  if (node.type === 'enum_declaration') {
    const name = nodeName(node);
    if (!name) return;
    pushTopLevelBinding(node, source, exported, name, 'enum', topLevelBindings);
    return;
  }

  if (node.type === 'lexical_declaration') {
    let hasArrow = false;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === 'variable_declarator') {
        const value = child.childForFieldName('value');
        if (value?.type === 'arrow_function') {
          hasArrow = true;
          const name = child.childForFieldName('name')?.text;
          if (!name) continue;
          const range = lineRange(node);
          const doc = leadingDoc(node, source);
          items.push({
            kind: 'function',
            name,
            signature: declaratorSignature(child, source),
            ...(doc !== undefined && { doc }),
            ...range,
            exported,
            startIndex: node.startIndex,
            endIndex: node.endIndex,
          });
        }
      }
    }
    if (!hasArrow) {
      const name = nodeName(node);
      if (name) {
        pushTopLevelBinding(node, source, exported, name, 'variable', topLevelBindings);
      }
    }
    return;
  }

  if (!DECLARATION_TYPES.has(node.type)) return;

  const name = nodeName(node);
  if (!name) return;

  const range = lineRange(node);
  const doc = leadingDoc(node, source);
  items.push({
    kind: kindForNode(node),
    name,
    signature: signatureWithoutBody(node, source),
    ...(doc !== undefined && { doc }),
    ...range,
    exported,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
  });
}

function walkDeclarations(
  node: Node,
  source: string,
  exported: boolean,
  items: OutlineItem[],
  topLevelBindings: OutlineItem[],
): void {
  if (node.type === 'export_statement') {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walkDeclarations(child, source, true, items, topLevelBindings);
    }
    return;
  }

  if (
    DECLARATION_TYPES.has(node.type) ||
    node.type === 'lexical_declaration'
  ) {
    collectDeclaration(node, source, exported, items, topLevelBindings);
    return;
  }

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walkDeclarations(child, source, exported, items, topLevelBindings);
  }
}

/** Extract imports + declaration outline from a TypeScript/TSX tree-sitter tree. */
export function extractTypeScriptDeclarations(root: Node, source: string): ExtractionResult {
  const imports: string[] = [];
  const items: OutlineItem[] = [];
  const topLevelBindings: OutlineItem[] = [];

  walkTree(root, (node) => {
    if (node.type === 'import_statement') {
      imports.push(importModule(node, source));
    }
  });

  walkDeclarations(root, source, false, items, topLevelBindings);

  return {
    imports: [...new Set(imports)],
    items,
    topLevelBindings,
  };
}
