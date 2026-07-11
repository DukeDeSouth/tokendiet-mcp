import type { Node } from 'web-tree-sitter';

export function walkTree(node: Node, visit: (node: Node) => void): void {
  visit(node);
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walkTree(child, visit);
  }
}

export function lineRange(node: Node): { startLine: number; endLine: number } {
  return {
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
  };
}

export function leadingDoc(node: Node, source: string): string | undefined {
  let prev = node.previousSibling;
  while (prev && (prev.type === 'comment' || prev.type === '\n')) {
    if (prev.type === 'comment') {
      const text = source.slice(prev.startIndex, prev.endIndex).trim();
      if (text.startsWith('/**') || text.startsWith('/*')) return text;
      break;
    }
    prev = prev.previousSibling;
  }
  return undefined;
}
