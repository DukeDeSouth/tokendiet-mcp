import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_BASE_DIR } from './refStore.js';

export interface ReadCacheRow {
  path: string;
  hash: string;
  ref: string;
  tokens_saved: number;
  updated_at: string;
}

export interface SessionStatRow {
  id: number;
  ts: string;
  tool: string;
  tokens_in: number;
  tokens_out: number;
  saved: number;
}

export interface StatsTotals {
  tokens_in: number;
  tokens_out: number;
  saved: number;
  calls: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS read_cache (
  path         TEXT PRIMARY KEY,
  hash         TEXT NOT NULL,
  ref          TEXT NOT NULL,
  tokens_saved INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_stats (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,
  session_id TEXT NOT NULL DEFAULT 'legacy',
  tool       TEXT NOT NULL,
  tokens_in  INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  saved      INTEGER NOT NULL
);
`;

export const DEFAULT_DB_PATH = join(DEFAULT_BASE_DIR, 'tokendiet.db');

export class Storage {
  private readonly db: Database.Database;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
    this.migrateSessionStats();
  }

  /** Add session_id to existing DBs created before P0-3. */
  private migrateSessionStats(): void {
    const cols = this.db.pragma('table_info(session_stats)') as { name: string }[];
    if (!cols.some((c) => c.name === 'session_id')) {
      this.db.exec(
        `ALTER TABLE session_stats ADD COLUMN session_id TEXT NOT NULL DEFAULT 'legacy'`,
      );
    }
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_session_stats_session ON session_stats(session_id)`,
    );
  }

  /** @deprecated Dormant — not used on hot path since P0-1. Reserved for future inter-session diff. */
  upsertReadCache(path: string, hash: string, ref: string, tokensSaved: number): void {
    this.db
      .prepare(
        `INSERT INTO read_cache (path, hash, ref, tokens_saved, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           hash = excluded.hash, ref = excluded.ref,
           tokens_saved = excluded.tokens_saved, updated_at = excluded.updated_at`,
      )
      .run(path, hash, ref, tokensSaved, new Date().toISOString());
  }

  /** @deprecated Dormant — not used on hot path since P0-1. Reserved for future inter-session diff. */
  getReadCache(path: string): ReadCacheRow | undefined {
    return this.db.prepare('SELECT * FROM read_cache WHERE path = ?').get(path) as
      | ReadCacheRow
      | undefined;
  }

  recordStat(
    sessionId: string,
    tool: string,
    tokensIn: number,
    tokensOut: number,
    saved: number,
  ): void {
    this.db
      .prepare(
        'INSERT INTO session_stats (ts, session_id, tool, tokens_in, tokens_out, saved) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(new Date().toISOString(), sessionId, tool, tokensIn, tokensOut, saved);
  }

  getSessionTotals(sessionId: string): StatsTotals {
    return this.db
      .prepare(
        `SELECT COALESCE(SUM(tokens_in), 0)  AS tokens_in,
                COALESCE(SUM(tokens_out), 0) AS tokens_out,
                COALESCE(SUM(saved), 0)      AS saved,
                COUNT(*)                     AS calls
         FROM session_stats
         WHERE session_id = ?`,
      )
      .get(sessionId) as StatsTotals;
  }

  /** All processes and legacy rows — former misleading \`stats.session\`. */
  getAllTimeTotals(): StatsTotals {
    return this.db
      .prepare(
        `SELECT COALESCE(SUM(tokens_in), 0)  AS tokens_in,
                COALESCE(SUM(tokens_out), 0) AS tokens_out,
                COALESCE(SUM(saved), 0)      AS saved,
                COUNT(*)                     AS calls
         FROM session_stats`,
      )
      .get() as StatsTotals;
  }

  /** @deprecated Use getAllTimeTotals — kept for internal grep safety during transition */
  getTotals(): StatsTotals {
    return this.getAllTimeTotals();
  }

  getMonthTotals(): StatsTotals {
    const monthPrefix = new Date().toISOString().slice(0, 7); // YYYY-MM
    return this.db
      .prepare(
        `SELECT COALESCE(SUM(tokens_in), 0)  AS tokens_in,
                COALESCE(SUM(tokens_out), 0) AS tokens_out,
                COALESCE(SUM(saved), 0)      AS saved,
                COUNT(*)                     AS calls
         FROM session_stats
         WHERE ts LIKE ?`,
      )
      .get(`${monthPrefix}%`) as StatsTotals;
  }

  close(): void {
    this.db.close();
  }
}
