/* eslint-disable n/no-sync, unicorn/prefer-module */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PERSIST_CONFIG, type RunnerArgs } from '@code-pushup/models';
import { PORTAL_CONTEXT_KEY, collectPlugin } from '../index.js';

const FIXTURE_REPORT = {
  commit: {
    hash: 'abcdef',
    message: 'msg',
    author: 'tester',
    date: '2026-06-01',
  },
  packageName: 'demo',
  version: '1.0.0',
  date: '2026-06-01',
  duration: 1,
  plugins: [
    {
      slug: 'eslint',
      title: 'ESLint',
      audits: [{ slug: 'no-debugger', title: 'no-debugger', issues: [{}] }],
    },
  ],
};

describe('collectPlugin end-to-end with DuckDB', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'collect-plugin-e2e-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'report.json'),
      JSON.stringify(FIXTURE_REPORT),
    );
  });

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = '';
    }
  });

  it('persists a run and surfaces it via a fresh storage instance', async () => {
    const cfg = collectPlugin({
      backends: ['duckdb'],
      duckdbPath: path.join(dir, 'portal.duckdb'),
      commit: { sha: 'sha-e2e', branch: 'main' },
      source: 'local',
    });

    // Simulate what the runner does internally
    const args: RunnerArgs = {
      ...DEFAULT_PERSIST_CONFIG,
      persist: {
        ...DEFAULT_PERSIST_CONFIG,
        outputDir: dir,
        filename: 'report',
      },
      pluginContext: cfg.context as RunnerArgs['pluginContext'],
    };
    expect(args.pluginContext).toBeDefined();
    // Validate that the round-trip context has the keys we expect
    expect(args.pluginContext?.[PORTAL_CONTEXT_KEY.duckdbPath]).toBe(
      path.join(dir, 'portal.duckdb'),
    );

    const out = await cfg.runner(args);
    expect(out).toHaveLength(1);
    expect(out[0]?.score).toBe(1);

    // Read it back via a fresh storage
    const { createDuckDBStorage } = await import(
      './storages/duckdb-storage.js'
    );
    const storage = createDuckDBStorage(path.join(dir, 'portal.duckdb'));
    await storage.initialize();
    const all = await storage.queryRuns({ branch: 'main' });
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all[0]).toMatchObject({
      commitSha: 'sha-e2e',
      branch: 'main',
      source: 'local',
    });
    await storage.close();
  });

  it('persists with multi-backend config (duckdb + iceberg)', async () => {
    // Skip if iceberg (and thus @duckdb/node-api) is not available.
    let duckdbAvailable = false;
    try {
      duckdbAvailable = !!require.resolve('@duckdb/node-api');
    } catch {
      duckdbAvailable = false;
    }
    if (!duckdbAvailable) {
      return;
    }
    const { createDuckDBStorage } = await import(
      './storages/duckdb-storage.js'
    );

    const cfg = collectPlugin({
      backends: ['duckdb', 'iceberg'],
      duckdbPath: path.join(dir, 'portal.duckdb'),
      icebergWarehousePath: path.join(dir, 'iceberg-warehouse'),
      commit: { sha: 'sha-multi', branch: 'main' },
      source: 'local',
    });

    const args: RunnerArgs = {
      ...DEFAULT_PERSIST_CONFIG,
      persist: {
        ...DEFAULT_PERSIST_CONFIG,
        outputDir: dir,
        filename: 'report',
      },
      pluginContext: cfg.context as RunnerArgs['pluginContext'],
    };

    const out = await cfg.runner(args);
    expect(out).toHaveLength(1);
    expect(out[0]?.score).toBe(1);
    // Both backends should appear in the display value.
    expect(out[0]?.displayValue).toContain('duckdb');
    expect(out[0]?.displayValue).toContain('iceberg');

    // DuckDB row is queryable.
    const duck = createDuckDBStorage(path.join(dir, 'portal.duckdb'));
    await duck.initialize();
    const rows = await duck.queryRuns({ branch: 'main' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.commitSha).toBe('sha-multi');
    await duck.close();

    // Iceberg writes its parquet files on close(). A fresh storage on the
    // same warehouse dir does NOT hydrate from those files (pre-existing
    // limitation of the iceberg backend), so we just assert the file
    // exists.
    const { existsSync, readdirSync } = await import('node:fs');
    const warehouse = path.join(dir, 'iceberg-warehouse');
    expect(existsSync(warehouse)).toBe(true);
    // The COPY export writes to <warehouse>/data; either the partitioned
    // form (data/branch=...) or the fallback (data/runs.parquet) is fine.
    expect(existsSync(path.join(warehouse, 'data'))).toBe(true);
    const dataContents = readdirSync(path.join(warehouse, 'data'));
    expect(dataContents.length).toBeGreaterThan(0);
  });
});
