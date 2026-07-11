import { parseDocument, ElementType } from 'htmlparser2';
import type { Element, Node } from 'domhandler';
import { textContent } from 'domutils';
import type { TransformResult } from '../../types.js';

const SKIP_TAGS = new Set([
  'script',
  'style',
  'nav',
  'footer',
  'header',
  'aside',
  'iframe',
  'svg',
  'noscript',
]);

export interface HtmlTransformMeta {
  contentUrls: string[];
  preCodeBlocks: string[];
}

function isElement(node: Node): node is Element {
  return node.type === ElementType.Tag;
}

function childElements(node: Element, tag: string): Element[] {
  return node.children.filter((c): c is Element => isElement(c) && c.name === tag);
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function renderTable(table: Element): string {
  const rows: string[] = [];
  for (const section of ['thead', 'tbody', 'tfoot']) {
    for (const group of childElements(table, section)) {
      for (const tr of childElements(group, 'tr')) {
        const cells = [
          ...childElements(tr, 'th'),
          ...childElements(tr, 'td'),
        ].map((cell) => collapseWhitespace(textContent(cell)));
        if (cells.some(Boolean)) rows.push(cells.join(' | '));
      }
    }
  }
  for (const tr of childElements(table, 'tr')) {
    const cells = [...childElements(tr, 'th'), ...childElements(tr, 'td')].map((cell) =>
      collapseWhitespace(textContent(cell)),
    );
    if (cells.some(Boolean)) rows.push(cells.join(' | '));
  }
  return [...new Set(rows)].join('\n');
}

function walk(
  nodes: Node[],
  parts: string[],
  meta: HtmlTransformMeta,
  skipDepth: number,
): number {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    const name = node.name.toLowerCase();

    if (SKIP_TAGS.has(name)) {
      skipDepth++;
      skipDepth = walk(node.children, parts, meta, skipDepth);
      skipDepth--;
      continue;
    }
    if (skipDepth > 0) {
      skipDepth = walk(node.children, parts, meta, skipDepth);
      continue;
    }

    if (/^h[1-6]$/.test(name)) {
      const text = collapseWhitespace(textContent(node));
      if (text) parts.push(`${'#'.repeat(Number(name[1]))} ${text}`);
      continue;
    }

    if (name === 'pre' || name === 'code') {
      const block = textContent(node);
      if (block.trim()) {
        meta.preCodeBlocks.push(block);
        parts.push(block);
      }
      continue;
    }

    if (name === 'a') {
      const href = node.attribs.href?.trim();
      const label = collapseWhitespace(textContent(node));
      if (href && /^https?:\/\//i.test(href)) {
        meta.contentUrls.push(href);
        parts.push(label ? `${label} (${href})` : href);
      } else if (label) {
        parts.push(label);
      }
      continue;
    }

    if (name === 'table') {
      const tableText = renderTable(node);
      if (tableText) parts.push(tableText);
      continue;
    }

    if (name === 'li') {
      const text = collapseWhitespace(textContent(node));
      if (text) parts.push(`- ${text}`);
      continue;
    }

    if (name === 'p') {
      const text = collapseWhitespace(textContent(node));
      if (text) parts.push(text);
      continue;
    }

    skipDepth = walk(node.children, parts, meta, skipDepth);
  }
  return skipDepth;
}

/** Strip boilerplate HTML and render readable text with metadata for verification. */
export function transformHtml(html: string): TransformResult & { htmlMeta: HtmlTransformMeta } {
  const doc = parseDocument(html);
  const parts: string[] = [];
  const meta: HtmlTransformMeta = { contentUrls: [], preCodeBlocks: [] };
  walk(doc.children, parts, meta, 0);
  const output = parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  return { output, htmlMeta: meta };
}
