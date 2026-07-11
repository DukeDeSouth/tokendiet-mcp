import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Storage } from '../src/storage/sqlite.js';
import { RefStore } from '../src/storage/refStore.js';

describe('Storage (sqlite)', () => {
  it('creates schema and round-trips read_cache', () => {
    const db = new Storage(':memory:');
    db.upsertReadCache('/src/a.ts', 'hash1', 'ref1', 120);
    const row = db.getReadCache('/src/a.ts');
    expect(row?.hash).toBe('hash1');
    expect(row?.tokens_saved).toBe(120);

    db.upsertReadCache('/src/a.ts', 'hash2', 'ref2', 200);
    expect(db.getReadCache('/src/a.ts')?.hash).toBe('hash2');
    db.close();
  });

  it('records session stats and aggregates totals', () => {
    const db = new Storage(':memory:');
    db.recordStat('sess-a', 'read', 1000, 200, 800);
    db.recordStat('sess-a', 'run', 500, 100, 400);
    const totals = db.getSessionTotals('sess-a');
    expect(totals.calls).toBe(2);
    expect(totals.tokens_in).toBe(1500);
    expect(totals.saved).toBe(1200);
    expect(db.getAllTimeTotals().saved).toBe(1200);
    db.close();
  });

  it('isolates stats per session_id on shared database', () => {
    const db = new Storage(':memory:');
    db.recordStat('sess-a', 'read', 1000, 100, 900);
    db.recordStat('sess-b', 'read', 200, 50, 150);
    expect(db.getSessionTotals('sess-a').saved).toBe(900);
    expect(db.getSessionTotals('sess-b').saved).toBe(150);
    expect(db.getAllTimeTotals().saved).toBe(1050);
    db.close();
  });

  it('migrates legacy session_stats without session_id column', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tokendiet-legacy-db-'));
    const dbPath = join(dir, 'legacy.db');
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE session_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        tool TEXT NOT NULL,
        tokens_in INTEGER NOT NULL,
        tokens_out INTEGER NOT NULL,
        saved INTEGER NOT NULL
      )`);
    raw
      .prepare('INSERT INTO session_stats (ts, tool, tokens_in, tokens_out, saved) VALUES (?, ?, ?, ?, ?)')
      .run('2026-01-01T00:00:00.000Z', 'read', 100, 10, 90);
    raw.close();

    const db = new Storage(dbPath);
    expect(db.getAllTimeTotals().saved).toBe(90);
    expect(db.getSessionTotals('fresh-session').calls).toBe(0);
    db.recordStat('fresh-session', 'read', 50, 5, 45);
    expect(db.getSessionTotals('fresh-session').saved).toBe(45);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns zero totals on empty database', () => {
    const db = new Storage(':memory:');
    expect(db.getSessionTotals('any')).toEqual({ tokens_in: 0, tokens_out: 0, saved: 0, calls: 0 });
    expect(db.getAllTimeTotals()).toEqual({ tokens_in: 0, tokens_out: 0, saved: 0, calls: 0 });
    db.close();
  });

  it('returns monthly totals', () => {
    const db = new Storage(':memory:');
    db.recordStat('sess', 'read', 100, 10, 90);
    expect(db.getMonthTotals().saved).toBe(90);
    db.close();
  });
});

describe('RefStore', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('stores and retrieves content, survives memory loss via files', () => {
    dir = mkdtempSync(join(tmpdir(), 'tokendiet-test-'));
    const store = new RefStore(dir);
    const ref = store.put('full original content');
    expect(store.get(ref)).toBe('full original content');

    // a fresh instance reads from disk
    const store2 = new RefStore(dir);
    expect(store2.get(ref)).toBe('full original content');
  });

  it('returns undefined for unknown refs', () => {
    dir = mkdtempSync(join(tmpdir(), 'tokendiet-test-'));
    expect(new RefStore(dir).get('nope')).toBeUndefined();
  });

  it('gc removes refs older than ttl by mtime', () => {
    dir = mkdtempSync(join(tmpdir(), 'tokendiet-test-'));
    const store = new RefStore(dir);
    const ref = store.put('stale payload');
    const file = join(dir, 'refs', `${ref}.txt`);
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    utimesSync(file, eightDaysAgo / 1000, eightDaysAgo / 1000);

    const fresh = new RefStore(dir);
    const result = fresh.gc({ ttlDays: 7, maxMb: 500 });
    expect(result.removed).toBe(1);
    expect(fresh.get(ref)).toBeUndefined();
  });

  it('gc keeps recent refs within ttl', () => {
    dir = mkdtempSync(join(tmpdir(), 'tokendiet-test-'));
    const store = new RefStore(dir);
    const ref = store.put('fresh payload');
    store.gc({ ttlDays: 7, maxMb: 500 });
    expect(store.get(ref)).toBe('fresh payload');
  });

  it('gc enforces max size cap evicting oldest refs first', () => {
    dir = mkdtempSync(join(tmpdir(), 'tokendiet-test-'));
    const store = new RefStore(dir);
    const payload = 'a'.repeat(400_000);
    const oldRef = store.put(payload);
    const oldFile = join(dir, 'refs', `${oldRef}.txt`);
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    utimesSync(oldFile, weekAgo / 1000, weekAgo / 1000);
    const newRef = store.put(payload);

    store.gc({ ttlDays: 365, maxMb: 0.5 });
    expect(store.get(oldRef)).toBeUndefined();
    expect(store.get(newRef)).toBe(payload);
  });
});
