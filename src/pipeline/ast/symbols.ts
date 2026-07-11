import type { OutlineItem } from './types.js';

/** Find outline item by simple name or `Class.method` path. */
export function findOutlineItem(items: OutlineItem[], symbolPath: string): OutlineItem | undefined {
  const parts = symbolPath.split('.');
  if (parts.length === 1) {
    return items.find((item) => item.name === parts[0]);
  }
  if (parts.length === 2) {
    const [className, methodName] = parts;
    const cls = items.find((item) => item.kind === 'class' && item.name === className);
    if (!cls) return undefined;
    return items.find(
      (item) =>
        item.kind === 'method' &&
        item.name === methodName &&
        item.startIndex >= cls.startIndex &&
        item.endIndex <= cls.endIndex,
    );
  }
  return undefined;
}
