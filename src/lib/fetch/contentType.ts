import { detectType } from '../../pipeline/detectType.js';
import type { ContentType } from '../../types.js';

const BINARY_PREFIXES = [
  'application/octet-stream',
  'image/',
  'video/',
  'audio/',
  'font/',
  'application/pdf',
  'application/zip',
  'application/gzip',
  'application/wasm',
];

export function isBinaryContentType(contentType: string): boolean {
  const base = contentType.split(';')[0]!.trim().toLowerCase();
  return BINARY_PREFIXES.some((p) => base === p || base.startsWith(p));
}

export function contentTypeForFetch(contentType: string, body: string): ContentType {
  const base = contentType.split(';')[0]!.trim().toLowerCase();
  if (base.includes('json')) return 'json';
  if (base.includes('html')) return 'html';
  if (base.startsWith('text/')) {
    return detectType(body, 'plain');
  }
  return detectType(body);
}
