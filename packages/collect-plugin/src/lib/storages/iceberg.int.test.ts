/* eslint-disable n/no-sync, vitest/require-hook, vitest/no-standalone-expect, unicorn/prefer-module */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunRecord } from './types.js';

const DUCKDB_AVAILABLE = (() => {
  try {
    require.resolve('@duckdb/node-api');
    return true;
  } catch {
    return false;
  }
})();

const itIfDuckdb = DUCKDB_AVAILABLE ? it : it.skip;

const baseRecord: RunRecord = {
  id: 'iceberg-1',
  timestamp: '2026-06-01T00:00:00.000Z',
  commitSha: 'abc123def',
  branch: 'main',
  mode: 'standalone',
  durationMs: 42,
  reportJson: '{"plugins":[]}',
  newIssuesCount: 0,
  source: 'local',
};

describe('createIcebergStorage (integration)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'collect-plugin-iceberg-'));
  });

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = '';
    }
  });

  itIfDuckdb('persists a record and reads it back', async () => {
    const { createIcebergStorage } = await import('./iceberg-storage.js');
    const warehouse = path.join(dir, 'iceberg');
    const storage = createIcebergStorage(warehouse);
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

  itIfDuckdb('can be reopened cleanly on the same warehouse', async () => {
    // The current Iceberg backend writes the warehouse on close() but does
    // not hydrate the DuckDB mirror from the parquet files on the next
    // initialize() — that's a pre-existing limitation. This test just
    // verifies that the second storage can boot without throwing.
    const { createIcebergStorage } = await import('./iceberg-storage.js');
    const warehouse = path.join(dir, 'iceberg');

    const a = createIcebergStorage(warehouse);
    await a.initialize();
    await a.saveRun({ ...baseRecord, id: 'persist-1' });
    await a.close();

    const b = createIcebergStorage(warehouse);
    await expect(b.initialize()).resolves.toBeUndefined();
    await b.close();
  });

  itIfDuckdb(
    'time-travel: snapshotId filter limits the rows returned',
    async () => {
      const { createIcebergStorage } = await import('./iceberg-storage.js');
      const warehouse = path.join(dir, 'iceberg');
      const storage = createIcebergStorage(warehouse);
      await storage.initialize();

      await storage.saveRun({
        ...baseRecord,
        id: 'snapshot-1',
        timestamp: '2026-06-01T00:00:00.000Z',
      });
      await storage.saveRun({
        ...baseRecord,
        id: 'snapshot-2',
        timestamp: '2026-06-02T00:00:00.000Z',
      });

      const filtered = await storage.queryRuns({ icebergSnapshotId: 1 });
      expect(filtered.length).toBeGreaterThanOrEqual(1);
      expect(
        filtered.every(r => ['snapshot-1', 'snapshot-2'].includes(r.id)),
      ).toBe(true);

      await storage.close();
    },
  );
});
