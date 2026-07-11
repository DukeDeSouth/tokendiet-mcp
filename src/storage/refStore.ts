import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const DEFAULT_BASE_DIR = join(homedir(), '.tokendiet');

const DEFAULT_TTL_DAYS = 7;
const DEFAULT_MAX_MB = 500;
const GC_SLOW_FILE_THRESHOLD = 10_000;

export interface RefGcOptions {
  ttlDays?: number;
  maxMb?: number;
  debug?: boolean;
}

export interface RefGcResult {
  removed: number;
  freedBytes: number;
  durationMs: number;
}

interface RefFileEntry {
  path: string;
  ref: string;
  mtimeMs: number;
  size: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function listRefFiles(dir: string): RefFileEntry[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.txt'))
    .map((name) => {
      const path = join(dir, name);
      const stat = statSync(path);
      return {
        path,
        ref: name.slice(0, -4),
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      };
    });
}

/**
 * Stores full originals so a compressed view is never a dead end:
 * expand(ref) (Sprint 1 tool) reads them back. In-memory map backed by
 * files so refs survive server restarts within a session.
 */
export class RefStore {
  private readonly memory = new Map<string, string>();
  private readonly dir: string;

  constructor(baseDir: string = DEFAULT_BASE_DIR) {
    this.dir = join(baseDir, 'refs');
  }

  put(content: string): string {
    const ref = randomUUID().slice(0, 8);
    this.memory.set(ref, content);
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${ref}.txt`), content, 'utf8');
    return ref;
  }

  get(ref: string): string | undefined {
    const cached = this.memory.get(ref);
    if (cached !== undefined) return cached;
    const file = join(this.dir, `${ref}.txt`);
    if (!existsSync(file)) return undefined;
    const content = readFileSync(file, 'utf8');
    this.memory.set(ref, content);
    return content;
  }

  /**
   * Remove stale refs by mtime (TTL) then enforce total size cap (oldest first).
   */
  gc(options: RefGcOptions = {}): RefGcResult {
    const ttlDays = options.ttlDays ?? envInt('TOKENDIET_REFS_TTL_DAYS', DEFAULT_TTL_DAYS);
    const maxMb = options.maxMb ?? envInt('TOKENDIET_REFS_MAX_MB', DEFAULT_MAX_MB);
    const debug = options.debug ?? process.env.TOKENDIET_DEBUG === 'true';
    const started = Date.now();

    if (!existsSync(this.dir)) {
      return { removed: 0, freedBytes: 0, durationMs: 0 };
    }

    const initial = listRefFiles(this.dir);
    let removed = 0;
    let freedBytes = 0;

    const remove = (entry: RefFileEntry) => {
      unlinkSync(entry.path);
      this.memory.delete(entry.ref);
      removed++;
      freedBytes += entry.size;
    };

    const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    if (ttlMs > 0) {
      for (const entry of initial) {
        if (now - entry.mtimeMs > ttlMs) remove(entry);
      }
    }

    const maxBytes = maxMb * 1024 * 1024;
    if (maxBytes > 0) {
      let remaining = listRefFiles(this.dir).sort((a, b) => a.mtimeMs - b.mtimeMs);
      let totalSize = remaining.reduce((sum, entry) => sum + entry.size, 0);
      for (const entry of remaining) {
        if (totalSize <= maxBytes) break;
        remove(entry);
        totalSize -= entry.size;
      }
    }

    const durationMs = Date.now() - started;
    if (debug && initial.length > GC_SLOW_FILE_THRESHOLD) {
      process.stderr.write(
        `[tokendiet] ref gc: ${initial.length} files scanned in ${durationMs}ms, removed ${removed}\n`,
      );
    }

    return { removed, freedBytes, durationMs };
  }
}
