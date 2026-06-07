/* eslint-disable n/no-sync */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunRecord } from './types.js';

const baseRecord: RunRecord = {
  id: 'test-id-1',
  timestamp: '2026-06-01T00:00:00.000Z',
  commitSha: 'abc123def',
  branch: 'main',
  mode: 'standalone',
  durationMs: 42,
  reportJson: '{"plugins":[]}',
  newIssuesCount: 0,
  source: 'local',
};

describe('createDuckDBStorage (integration)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'collect-plugin-duckdb-'));
  });

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = '';
    }
  });

  it('persists a record and reads it back', async () => {
    const { createDuckDBStorage } = await import('./duckdb-storage.js');
    const dbPath = path.join(dir, 'portal.duckdb');
    const storage = createDuckDBStorage(dbPath);
    await storage.initialize();
    await storage.saveRun(baseRecord);

    const fetched = await storage.getRun(baseRecord.id);
    expect(fetched).toMatchObject({
      id: baseRecord.id,
      commitSha: baseRecord.commitSha,
      branch: baseRecord.branch,
      source: 'local',
      mode: 'standalone',
    });

    const all = await storage.queryRuns({ branch: 'main' });
    expect(all).toHaveLength(1);

    await storage.close();
  });

  it('supports upsert on conflict', async () => {
    const { createDuckDBStorage } = await import('./duckdb-storage.js');
    const dbPath = path.join(dir, 'upsert.duckdb');
    const storage = createDuckDBStorage(dbPath);
    await storage.initialize();
    await storage.saveRun(baseRecord);
    await storage.saveRun({
      ...baseRecord,
      newIssuesCount: 7,
    });

    const all = await storage.queryRuns({ branch: 'main' });
    expect(all).toHaveLength(1);
    expect(all[0]?.newIssuesCount).toBe(7);

    await storage.close();
  });
});
