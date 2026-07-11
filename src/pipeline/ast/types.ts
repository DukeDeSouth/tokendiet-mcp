export type OutlineKind =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'variable';

export interface OutlineItem {
  kind: OutlineKind;
  name: string;
  signature: string;
  doc?: string;
  startLine: number;
  endLine: number;
  exported: boolean;
  /** Byte range in source for symbol extraction. */
  startIndex: number;
  endIndex: number;
}

export type CodeOutlineMode = 'outline' | 'signatures' | 'symbol';

export interface ExtractionResult {
  imports: string[];
  items: OutlineItem[];
}
