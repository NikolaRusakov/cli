/* eslint-disable functional/no-loop-statements, unicorn/no-useless-undefined, unicorn/better-regex, jest-extended/prefer-to-have-been-called-once */
import { vi } from 'vitest';
import {
  type BackendStorage,
  DEFAULT_DOLTDB_BRANCH,
  DEFAULT_DOLTDB_PATH,
  DEFAULT_DUCKDB_PATH,
  DEFAULT_ICEBERG_PATH,
  closePortalStorages,
  createPortalStorages,
  parsePortalConfigFromEnv,
  saveToPortal,
} from './portal.js';
import type { RunRecord } from './storages/types.js';

describe('parsePortalConfigFromEnv', () => {
  it('returns null when CP_PORTAL_ENABLED is not truthy', () => {
    expect(parsePortalConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('returns null for unknown truthy values', () => {
    expect(
      parsePortalConfigFromEnv({
        CP_PORTAL_ENABLED: 'maybe',
      } as unknown as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it('returns a default config when CP_PORTAL_ENABLED is true', () => {
    const config = parsePortalConfigFromEnv({
      CP_PORTAL_ENABLED: 'true',
    } as unknown as NodeJS.ProcessEnv);
    expect(config).toEqual({
      backends: ['duckdb'],
      duckdbPath: DEFAULT_DUCKDB_PATH,
      icebergWarehousePath: DEFAULT_ICEBERG_PATH,
      doltdbPath: DEFAULT_DOLTDB_PATH,
      doltdbBranch: DEFAULT_DOLTDB_BRANCH,
    });
  });

  it('parses a comma-separated backend list', () => {
    const config = parsePortalConfigFromEnv({
      CP_PORTAL_ENABLED: '1',
      CP_PORTAL_BACKENDS: 'duckdb, iceberg, doltdb',
    } as unknown as NodeJS.ProcessEnv);
    expect(config?.backends).toEqual(['duckdb', 'iceberg', 'doltdb']);
  });

  it('honors custom paths', () => {
    const config = parsePortalConfigFromEnv({
      CP_PORTAL_ENABLED: 'yes',
      CP_PORTAL_DUCKDB_PATH: '/var/data/cp.duckdb',
      CP_PORTAL_ICEBERG_PATH: '/var/data/iceberg',
      CP_PORTAL_DOLTDB_PATH: '/var/data/dolt',
      CP_PORTAL_DOLTDB_BRANCH: 'release/2026-Q1',
    } as unknown as NodeJS.ProcessEnv);
    expect(config).toEqual({
      backends: ['duckdb'],
      duckdbPath: '/var/data/cp.duckdb',
      icebergWarehousePath: '/var/data/iceberg',
      doltdbPath: '/var/data/dolt',
      doltdbBranch: 'release/2026-Q1',
    });
  });
});

describe('createPortalStorages', () => {
  it('returns one entry per backend with the correct discriminator', () => {
    const storages = createPortalStorages({
      backends: ['duckdb', 'iceberg'],
    });
    expect(storages).toHaveLength(2);
    expect(storages.map(s => s.backend)).toEqual(['duckdb', 'iceberg']);
    for (const { storage } of storages) {
      expect(typeof storage.initialize).toBe('function');
      expect(typeof storage.saveRun).toBe('function');
      expect(typeof storage.close).toBe('function');
    }
  });
});

function makeStubStorage(opts: {
  ok?: boolean;
  error?: string;
  initSpy?: ReturnType<typeof vi.fn>;
  saveSpy?: ReturnType<typeof vi.fn>;
  closeSpy?: ReturnType<typeof vi.fn>;
}) {
  const initSpy = opts.initSpy ?? vi.fn(async () => undefined);
  const saveSpy =
    opts.saveSpy ??
    vi.fn(async () => {
      if (opts.ok === false) {
        throw new Error(opts.error ?? 'simulated failure');
      }
    });
  const closeSpy = opts.closeSpy ?? vi.fn(async () => undefined);
  return {
    storage: {
      initialize: initSpy,
      saveRun: saveSpy,
      queryRuns: vi.fn(async () => []),
      getRun: vi.fn(async () => null),
      close: closeSpy,
    },
    initSpy,
    saveSpy,
    closeSpy,
  };
}

describe('saveToPortal', () => {
  it('returns an empty array when there are no storages', async () => {
    const results = await saveToPortal(
      [{ reportJson: '{}' }],
      { commitSha: 'a', branch: 'main', source: 'local', startTime: 0 },
      [],
    );
    expect(results).toEqual([]);
  });

  it('initializes every storage and calls saveRun for each input', async () => {
    const a = makeStubStorage({});
    const b = makeStubStorage({});
    const storages: BackendStorage[] = [
      { backend: 'duckdb', storage: a.storage },
      { backend: 'iceberg', storage: b.storage },
    ];
    const results = await saveToPortal(
      [
        { mode: 'standalone', reportJson: '{"a":1}' },
        { mode: 'monorepo', project: 'p1', reportJson: '{"a":2}' },
      ],
      { commitSha: 'sha', branch: 'main', source: 'local', startTime: 0 },
      storages,
    );
    expect(a.initSpy).toHaveBeenCalledTimes(1);
    expect(b.initSpy).toHaveBeenCalledTimes(1);
    expect(a.saveSpy).toHaveBeenCalledTimes(2);
    expect(b.saveSpy).toHaveBeenCalledTimes(2);
    expect(results).toEqual([
      { backend: 'duckdb', ok: true },
      { backend: 'iceberg', ok: true },
    ]);
  });

  it('attaches a stable id and ISO timestamp to every saved record', async () => {
    const { storage, saveSpy } = makeStubStorage({});
    await saveToPortal(
      [{ reportJson: '{}' }],
      { commitSha: 'sha', branch: 'main', source: 'local', startTime: 0 },
      [{ backend: 'duckdb', storage }],
    );
    const record = saveSpy.mock.calls[0]?.[0] as RunRecord;
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(() => new Date(record.timestamp).toISOString()).not.toThrow();
    expect(new Date(record.timestamp).toISOString()).toBe(record.timestamp);
    expect(record.commitSha).toBe('sha');
    expect(record.branch).toBe('main');
    expect(record.source).toBe('local');
    expect(record.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns ok=false with the error message when a backend throws', async () => {
    const ok = makeStubStorage({});
    const bad = makeStubStorage({ ok: false, error: 'disk full' });
    const results = await saveToPortal(
      [{ reportJson: '{}' }],
      { commitSha: 'sha', branch: 'main', source: 'local', startTime: 0 },
      [
        { backend: 'duckdb', storage: ok.storage },
        { backend: 'iceberg', storage: bad.storage },
      ],
    );
    expect(results).toEqual([
      { backend: 'duckdb', ok: true },
      { backend: 'iceberg', ok: false, error: 'disk full' },
    ]);
  });

  it('continues saving to other backends even if one fails', async () => {
    const ok = makeStubStorage({});
    const bad = makeStubStorage({ ok: false, error: 'boom' });
    await saveToPortal(
      [{ reportJson: '{}' }],
      { commitSha: 'sha', branch: 'main', source: 'local', startTime: 0 },
      [
        { backend: 'duckdb', storage: ok.storage },
        { backend: 'iceberg', storage: bad.storage },
      ],
    );
    expect(ok.saveSpy).toHaveBeenCalledTimes(1);
    expect(bad.saveSpy).toHaveBeenCalledTimes(1);
  });
});

describe('closePortalStorages', () => {
  it('calls close() on every storage', async () => {
    const a = makeStubStorage({});
    const b = makeStubStorage({});
    await closePortalStorages([
      { backend: 'duckdb', storage: a.storage },
      { backend: 'iceberg', storage: b.storage },
    ]);
    expect(a.closeSpy).toHaveBeenCalledTimes(1);
    expect(b.closeSpy).toHaveBeenCalledTimes(1);
  });

  it('does not throw when one close() rejects', async () => {
    const a = makeStubStorage({
      closeSpy: vi.fn(async () => {
        throw new Error('close failed');
      }),
    });
    const b = makeStubStorage({});
    await expect(
      closePortalStorages([
        { backend: 'duckdb', storage: a.storage },
        { backend: 'iceberg', storage: b.storage },
      ]),
    ).resolves.toBeUndefined();
    expect(b.closeSpy).toHaveBeenCalledTimes(1);
  });
});
