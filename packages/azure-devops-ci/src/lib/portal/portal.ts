import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunResult } from '@code-pushup/ci';
import { optionalBooleanEnv, optionalEnv } from '../env.js';
import { createDuckDBStorage } from './duckdb-storage.js';
import { createDoltDBStorage } from './doltdb-storage.js';
import { createIcebergStorage } from './iceberg-storage.js';
import type {
  PortalConfig,
  PortalStorage,
  RunRecord,
  StorageBackend,
} from './types.js';

/**
 * Creates and manages portal storage backends for persisting run results.
 *
 * The portal supports multiple simultaneous backends:
 * - DuckDB for fast analytical queries (default)
 * - Iceberg for schema evolution and time travel
 * - DoltDB for git-like data versioning
 *
 * Configuration via environment variables:
 * - CP_PORTAL_ENABLED=true           Enable portal storage
 * - CP_PORTAL_BACKENDS=duckdb,doltdb Comma-separated backend list
 * - CP_PORTAL_DUCKDB_PATH=./data.db  DuckDB file path
 * - CP_PORTAL_ICEBERG_PATH=./iceberg Iceberg warehouse directory
 * - CP_PORTAL_DOLTDB_PATH=./doltdata DoltDB repo directory
 * - CP_PORTAL_DOLTDB_BRANCH=main     DoltDB branch for writes
 */
export function parsePortalConfigFromEnv(): PortalConfig | null {
  const enabled = optionalBooleanEnv('CP_PORTAL_ENABLED');
  if (!enabled) {
    return null;
  }

  const backendsStr = optionalEnv('CP_PORTAL_BACKENDS') ?? 'duckdb';
  const backends = backendsStr.split(',').map(b => b.trim()) as StorageBackend[];

  return {
    backends,
    duckdbPath: optionalEnv('CP_PORTAL_DUCKDB_PATH') ?? '.code-pushup/portal.duckdb',
    icebergWarehousePath:
      optionalEnv('CP_PORTAL_ICEBERG_PATH') ?? '.code-pushup/iceberg-warehouse',
    doltdbPath: optionalEnv('CP_PORTAL_DOLTDB_PATH') ?? '.code-pushup/doltdb',
    doltdbBranch: optionalEnv('CP_PORTAL_DOLTDB_BRANCH') ?? 'main',
  };
}

/**
 * Creates storage instances for all configured backends.
 */
export function createPortalStorages(config: PortalConfig): PortalStorage[] {
  return config.backends.map(backend => createStorage(backend, config));
}

function createStorage(
  backend: StorageBackend,
  config: PortalConfig,
): PortalStorage {
  switch (backend) {
    case 'duckdb':
      return createDuckDBStorage(
        config.duckdbPath ?? '.code-pushup/portal.duckdb',
      );
    case 'iceberg':
      return createIcebergStorage(
        config.icebergWarehousePath ?? '.code-pushup/iceberg-warehouse',
      );
    case 'doltdb':
      return createDoltDBStorage(
        config.doltdbPath ?? '.code-pushup/doltdb',
        config.doltdbBranch ?? 'main',
      );
  }
}

/**
 * Persists a Code PushUp run result to all configured portal backends.
 */
export async function saveRunToPortal(
  result: RunResult,
  context: {
    commitSha: string;
    branch: string;
    pullRequestId?: number;
    organization: string;
    azProject: string;
    repository: string;
    startTime: number;
  },
  storages: PortalStorage[],
): Promise<void> {
  if (storages.length === 0) {
    return;
  }

  const records = buildRunRecords(result, context);

  for (const storage of storages) {
    await storage.initialize();
    for (const record of records) {
      await storage.saveRun(record);
    }
  }
}

/**
 * Closes all portal storage connections.
 */
export async function closePortalStorages(
  storages: PortalStorage[],
): Promise<void> {
  await Promise.allSettled(storages.map(s => s.close()));
}

function buildRunRecords(
  result: RunResult,
  context: {
    commitSha: string;
    branch: string;
    pullRequestId?: number;
    organization: string;
    azProject: string;
    repository: string;
    startTime: number;
  },
): RunRecord[] {
  const durationMs = Date.now() - context.startTime;
  const baseRecord = {
    timestamp: new Date().toISOString(),
    commitSha: context.commitSha,
    branch: context.branch,
    pullRequestId: context.pullRequestId,
    organization: context.organization,
    azProject: context.azProject,
    repository: context.repository,
    durationMs,
  };

  if (result.mode === 'standalone') {
    return [
      {
        ...baseRecord,
        id: randomUUID(),
        mode: 'standalone' as const,
        project: undefined,
        score: undefined,
        reportJson: safeReadFileSync(result.files.current.json),
        diffJson: result.files.comparison
          ? safeReadFileSync(result.files.comparison.json)
          : undefined,
        newIssuesCount: result.newIssues?.length ?? 0,
      },
    ];
  }

  // Monorepo: one record per project
  return result.projects.map(proj => ({
    ...baseRecord,
    id: randomUUID(),
    mode: 'monorepo' as const,
    project: proj.name,
    score: undefined,
    reportJson: safeReadFileSync(proj.files.current.json),
    diffJson: proj.files.comparison
      ? safeReadFileSync(proj.files.comparison.json)
      : undefined,
    newIssuesCount: proj.newIssues?.length ?? 0,
  }));
}

function safeReadFileSync(filePath: string): string {
  try {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    return readFileSync(filePath, 'utf8');
  } catch {
    return '{}';
  }
}
