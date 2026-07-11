import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Encoding } from './types.js';
import { DEFAULT_ENCODING } from './tokenize/counter.js';
import { RefStore } from './storage/refStore.js';
import { Storage } from './storage/sqlite.js';
import type { ResolvedReadMode } from './tools/readMode.js';

export function resolveHomeDir(): string {
  return process.env.TOKENDIET_HOME ?? join(homedir(), '.tokendiet');
}

export interface ServedFile {
  hash: string;
  ref: string;
  mode: ResolvedReadMode;
  symbol?: string;
}

export interface AppContext {
  workspace: string;
  encoding: Encoding;
  sessionId: string;
  storage: Storage;
  refStore: RefStore;
  smallFileTokenThreshold: number;
  /** Code files at or above this BPE count use outline in auto mode (default 800). */
  codeOutlineThreshold: number;
  /** Min savings ratio for diff vs full file (1 = diff must be smaller than file tokens). */
  diffWorthwhileRatio: number;
  /** Files whose content was already returned to the agent in this MCP process. */
  servedThisSession: Map<string, ServedFile>;
}

export function createContext(overrides: Partial<AppContext> = {}): AppContext {
  const home = resolveHomeDir();
  return {
    workspace: process.env.TOKENDIET_WORKSPACE ?? process.cwd(),
    encoding: DEFAULT_ENCODING,
    sessionId: randomUUID(),
    storage: new Storage(join(home, 'tokendiet.db')),
    refStore: new RefStore(home),
    smallFileTokenThreshold: 200,
    codeOutlineThreshold: 800,
    diffWorthwhileRatio: 1,
    servedThisSession: new Map(),
    ...overrides,
  };
}
