import type { ContentType, TransformOptions, TransformResult } from '../types.js';
import { transformLog } from './transforms/log.js';
import { transformJson } from './transforms/json.js';
import { transformHtml } from './transforms/html.js';
import { transformTestOutput } from './transforms/testOutput.js';
import { transformPlain } from './transforms/plain.js';

type TransformFn = (content: string, options: TransformOptions) => TransformResult;

/**
 * Sprint 0 dispatch table. 'code' and 'html' fall back to the plain
 * transform until the AST layer (Sprint 2) lands.
 */
const TRANSFORMS: Record<ContentType, TransformFn> = {
  log: (c) => transformLog(c),
  json: (c, o) => transformJson(c, o),
  test_output: (c) => transformTestOutput(c),
  plain: (c) => transformPlain(c),
  code: (c) => transformPlain(c),
  html: (c) => transformHtml(c),
};

export function applyTransform(
  type: ContentType,
  content: string,
  options: TransformOptions = {},
): TransformResult {
  try {
    return TRANSFORMS[type](content, options);
  } catch (err) {
    // A transform must never break the pipeline; fall back to the original.
    return { output: content, notes: [`transform threw: ${(err as Error).message}`] };
  }
}
