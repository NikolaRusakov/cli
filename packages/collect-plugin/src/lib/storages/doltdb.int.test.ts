/* eslint-disable n/no-sync, @typescript-eslint/no-dynamic-delete, functional/immutable-data, unicorn/prefer-ternary, functional/no-loop-statements, vitest/require-hook, vitest/no-standalone-expect */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunRecord } from './types.js';

const DOLT_AVAILABLE = (() => {
  try {
    execSync('dolt version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const itIfDolt = DOLT_AVAILABLE ? it : it.skip;

const envKeysToRestore = ['DOLT_ROOT_DIR'] as const;
const originalEnv: Record<string, string | undefined> = {};
for (const key of envKeysToRestore) {
  originalEnv[key] = process.env[key];
}

function setupDolt(): string {
  // Provide a global identity so `dolt commit` works on first save.
  execSync('dolt config --global --add user.email dolt@example.com', {
    stdio: 'ignore',
  });
  execSync('dolt config --global --add user.name "Dolt Test"', {
    stdio: 'ignore',
  });
  const dir = mkdtempSync(path.join(tmpdir(), 'collect-plugin-dolt-'));
  process.env['DOLT_ROOT_DIR'] = dir;
  return dir;
}

function teardownDolt(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  for (const key of envKeysToRestore) {
    const original = originalEnv[key];
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
}

const baseRecord: RunRecord = {
  id: 'dolt-1',
  timestamp: '2026-06-01T00:00:00.000Z',
  commitSha: 'abc123',
  branch: 'main',
  mode: 'standalone',
  durationMs: 1,
  reportJson: '{"plugins":[]}',
  newIssuesCount: 0,
  source: 'local',
};

describe('createDoltDBStorage (integration)', () => {
  let dir: string;

  beforeEach(() => {
    if (DOLT_AVAILABLE) {
      dir = setupDolt();
    } else {
      dir = '';
    }
  });

  afterEach(() => {
    if (dir) {
      teardownDolt(dir);
    }
  });

  itIfDolt('persists a record and reads it back', async () => {
    const { createDoltDBStorage } = await import('./doltdb-storage.js');
    const storage = createDoltDBStorage(path.join(dir, 'dolt-repo'), 'main');
    await storage.initialize();
    await storage.saveRun(baseRecord);

    const fetched = await storage.getRun(baseRecord.id);
    expect(fetched).toMatchObject({
      id: baseRecord.id,
      commitSha: baseRecord.commitSha,
      source: 'local',
    });

    await storage.close();
  });

  itIfDolt('saveRun is idempotent on the same id (REPLACE INTO)', async () => {
    const { createDoltDBStorage } = await import('./doltdb-storage.js');
    const storage = createDoltDBStorage(path.join(dir, 'dolt-repo'), 'main');
    await storage.initialize();
    await storage.saveRun(baseRecord);
    await storage.saveRun({ ...baseRecord, newIssuesCount: 7 });

    const all = await storage.queryRuns({ branch: 'main' });
    expect(all).toHaveLength(1);
    expect(all[0]?.newIssuesCount).toBe(7);

    await storage.close();
  });
});
