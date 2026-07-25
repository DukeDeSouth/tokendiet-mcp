export type OutlineKind =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'variable'
  | 'enum';

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

export type CodeOutlineMode = 'outline' | 'outline_plus' | 'signatures' | 'symbol';

export interface ExtractionResult {
  imports: string[];
  items: OutlineItem[];
  /** Module-level const/enum bindings rendered in full for outline+. */
  topLevelBindings: OutlineItem[];
}
