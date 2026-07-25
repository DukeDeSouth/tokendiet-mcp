import { randomUUID } from 'node:crypto';
import type { Encoding } from '../types.js';
import { DEFAULT_ENCODING } from '../tokenize/counter.js';
import { RefStore } from '../storage/refStore.js';
import { Storage } from '../storage/sqlite.js';
import { loadShrinkConfig, resolveShrinkProfile, type ShrinkConfig, type ShrinkServerProfile } from './config.js';

export interface ShrinkContext {
  config: ShrinkConfig;
  profile: ShrinkServerProfile;
  refStore: RefStore;
  storage: Storage;
  sessionId: string;
  encoding: Encoding;
  serverName: string;
}

export function createShrinkContext(serverName?: string): ShrinkContext {
  const config = loadShrinkConfig();
  const name = serverName?.trim() || process.env.TOKENDIET_SHRINK_SERVER?.trim() || 'default';
  return {
    config,
    profile: resolveShrinkProfile(config, name),
    refStore: new RefStore(),
    storage: new Storage(),
    sessionId: `shrink-${randomUUID()}`,
    encoding: DEFAULT_ENCODING,
    serverName: name,
  };
}
