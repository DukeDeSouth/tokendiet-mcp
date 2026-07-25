import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ShrinkServerProfile {
  allow_tools: string[] | null;
  deny_tools: string[];
  min_text_tokens: number;
  content_hint?: string;
}

export interface ShrinkConfig {
  compress_tool_descriptions: boolean;
  compress_call_results: boolean;
  min_text_tokens: number;
  min_saved_tokens: number;
  servers: Record<string, ShrinkServerProfile>;
}

const DEFAULT_CONFIG: ShrinkConfig = {
  compress_tool_descriptions: true,
  compress_call_results: true,
  min_text_tokens: 300,
  min_saved_tokens: 50,
  servers: {
    default: {
      allow_tools: null,
      deny_tools: [],
      min_text_tokens: 300,
    },
  },
};

let cached: ShrinkConfig | undefined;

function pkgRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export function loadShrinkConfig(path?: string): ShrinkConfig {
  if (cached && !path) return cached;
  const configPath = path ?? join(pkgRoot(), 'shrink.config.json');
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as ShrinkConfig;
    cached = { ...DEFAULT_CONFIG, ...raw, servers: { ...DEFAULT_CONFIG.servers, ...raw.servers } };
    return cached;
  } catch {
    cached = DEFAULT_CONFIG;
    return cached;
  }
}

export function clearShrinkConfigCache(): void {
  cached = undefined;
}

export function resolveShrinkProfile(
  config: ShrinkConfig,
  serverName?: string,
): ShrinkServerProfile {
  const name = serverName?.trim() || 'default';
  const base = config.servers.default ?? DEFAULT_CONFIG.servers.default!;
  const specific = config.servers[name];
  if (!specific) return { ...base };
  return {
    allow_tools: specific.allow_tools ?? base.allow_tools,
    deny_tools: specific.deny_tools ?? base.deny_tools,
    min_text_tokens: specific.min_text_tokens ?? base.min_text_tokens,
    ...(specific.content_hint !== undefined && { content_hint: specific.content_hint }),
  };
}

export function shouldShrinkTool(toolName: string, profile: ShrinkServerProfile): boolean {
  if (profile.deny_tools.includes(toolName)) return false;
  if (profile.allow_tools && !profile.allow_tools.includes(toolName)) return false;
  return true;
}
