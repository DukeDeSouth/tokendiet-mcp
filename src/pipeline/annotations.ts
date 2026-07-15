import type { OutlineItem } from './ast/types.js';
import type { Encoding } from '../types.js';
import { countTokens } from '../tokenize/counter.js';

export interface AnnotationBlock {
  lines: string[];
  startLine: number;
  endLine: number;
  symbol?: string;
  tags: string[];
}

export interface AnnotationExtraction {
  fileLevel: AnnotationBlock[];
  bySymbol: Map<string, AnnotationBlock[]>;
  /** All blocks with at least one critical tag. */
  critical: AnnotationBlock[];
}

const TAG_PATTERNS: { tag: string; re: RegExp }[] = [
  { tag: 'SECURITY', re: /\bSECURITY\b/i },
  { tag: 'SAFETY', re: /\bSAFETY\b/i },
  { tag: 'DANGER', re: /\bDANGER\b/i },
  { tag: 'UNSAFE', re: /\bUNSAFE\b/i },
  { tag: 'TODO', re: /\bTODO\b/i },
  { tag: 'FIXME', re: /\bFIXME\b/i },
  { tag: 'HACK', re: /\bHACK\b/i },
  { tag: 'XXX', re: /\bXXX\b/i },
  { tag: 'SECRET', re: /\b(API key|secret|password|token)\b/i },
  { tag: 'APPROVAL', re: /\bwithout approval\b/i },
  { tag: 'DEPRECATED', re: /@deprecated\b/i },
];

const URL_RE = /https?:\/\/[^\s"'`)\]}>]+/g;

function tagsForLine(line: string): string[] {
  const tags: string[] = [];
  for (const { tag, re } of TAG_PATTERNS) {
    if (re.test(line)) tags.push(tag);
  }
  return tags;
}

function isCommentLine(trimmed: string): boolean {
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.endsWith('*/')
  );
}

function blockFromLines(
  lines: string[],
  startLine: number,
  symbol?: string,
): AnnotationBlock | null {
  const tags = new Set<string>();
  for (const line of lines) {
    for (const t of tagsForLine(line)) tags.add(t);
  }
  if (tags.size === 0) return null;
  return {
    lines: [...lines],
    startLine,
    endLine: startLine + lines.length - 1,
    ...(symbol !== undefined && { symbol }),
    tags: [...tags],
  };
}

function extractFileLevel(lines: string[]): AnnotationBlock[] {
  const commentRun: string[] = [];
  const blocks: AnnotationBlock[] = [];
  let runStart = 1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed.length === 0) {
      if (commentRun.length > 0) {
        const b = blockFromLines(commentRun, runStart);
        if (b) blocks.push(b);
        commentRun.length = 0;
      }
      continue;
    }
    if (isCommentLine(trimmed)) {
      if (commentRun.length === 0) runStart = i + 1;
      commentRun.push(lines[i]!);
      continue;
    }
    break;
  }
  if (commentRun.length > 0) {
    const b = blockFromLines(commentRun, runStart);
    if (b) blocks.push(b);
  }
  return blocks;
}

function leadingCommentsAbove(lines: string[], startLine: number): string[] {
  const out: string[] = [];
  for (let i = startLine - 2; i >= 0; i--) {
    const trimmed = lines[i]!.trim();
    if (trimmed.length === 0) {
      if (out.length > 0) break;
      continue;
    }
    if (!isCommentLine(trimmed)) break;
    out.unshift(lines[i]!);
  }
  return out;
}

function urlsInBody(source: string, item: OutlineItem): string[] {
  const body = source.slice(item.startIndex, item.endIndex);
  const sig = item.signature;
  const urls = new Set<string>();
  for (const m of body.matchAll(URL_RE)) {
    const url = m[0]!;
    if (!sig.includes(url)) urls.add(url);
  }
  return [...urls];
}

/** Scan source for critical comment blocks and attach to nearest symbols. */
export function extractAnnotations(content: string, items: OutlineItem[]): AnnotationExtraction {
  const lines = content.split('\n');
  const fileLevel = extractFileLevel(lines);
  const bySymbol = new Map<string, AnnotationBlock[]>();

  for (const item of items) {
    const attached = leadingCommentsAbove(lines, item.startLine);
    const blocks: AnnotationBlock[] = [];
    if (attached.length > 0) {
      const b = blockFromLines(attached, item.startLine - attached.length, item.name);
      if (b) blocks.push(b);
    }
    const bodyUrls = urlsInBody(content, item);
    if (bodyUrls.length > 0) {
      blocks.push({
        lines: bodyUrls.map((u) => `// url: ${u}`),
        startLine: item.startLine,
        endLine: item.startLine,
        symbol: item.name,
        tags: ['URL'],
      });
    }
    if (blocks.length > 0) bySymbol.set(item.name, blocks);
  }

  const critical: AnnotationBlock[] = [...fileLevel];
  for (const blocks of bySymbol.values()) {
    for (const b of blocks) {
      if (!critical.some((c) => c.lines.join('\n') === b.lines.join('\n'))) {
        critical.push(b);
      }
    }
  }

  return { fileLevel, bySymbol, critical };
}

export interface BudgetResult {
  text: string;
  partial: boolean;
  omittedLines: number;
}

/** Cap annotation text by BPE budget; append marker when truncated. */
export function applyAnnotationBudget(
  text: string,
  maxTokens: number,
  encoding: Encoding,
): BudgetResult {
  if (maxTokens <= 0 || countTokens(text, encoding) <= maxTokens) {
    return { text, partial: false, omittedLines: 0 };
  }
  const lines = text.split('\n');
  const kept: string[] = [];
  let omitted = 0;
  for (const line of lines) {
    const candidate = [...kept, line].join('\n');
    if (countTokens(candidate, encoding) > maxTokens && kept.length > 0) {
      omitted = lines.length - kept.length;
      break;
    }
    kept.push(line);
  }
  const marker =
    omitted > 0 ? `\n[${omitted} more annotation lines — expand(ref)]` : '';
  return {
    text: kept.join('\n') + marker,
    partial: omitted > 0,
    omittedLines: omitted,
  };
}

export function defaultAnnotationBudget(): number {
  const raw = process.env.TOKENDIET_ANNOTATION_BUDGET;
  if (raw === undefined || raw === '') return 150;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 150;
}

export function countBodyUrls(extraction: AnnotationExtraction): number {
  let n = 0;
  for (const blocks of extraction.bySymbol.values()) {
    for (const b of blocks) {
      if (b.tags.includes('URL')) n += b.lines.length;
    }
  }
  return n;
}
