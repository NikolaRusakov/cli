/* eslint-disable functional/immutable-data, functional/no-loop-statements */
import { optionalBooleanEnv, optionalEnv } from './env.js';
import {
  type RunContext,
  type RunRecordInput,
  buildRunRecords,
} from './record.js';
import { createDoltDBStorage } from './storages/doltdb-storage.js';
import { createDuckDBStorage } from './storages/duckdb-storage.js';
import { createIcebergStorage } from './storages/iceberg-storage.js';
import type {
  PortalConfig,
  PortalStorage,
  StorageBackend,
} from './storages/types.js';

/**
 * Default paths for portal storage backends.
 */
export const DEFAULT_DUCKDB_PATH = '.code-pushup/portal.duckdb';
export const DEFAULT_ICEBERG_PATH = '.code-pushup/iceberg-warehouse';
export const DEFAULT_DOLTDB_PATH = '.code-pushup/doltdb';
export const DEFAULT_DOLTDB_BRANCH = 'main';

/**
 * A backend paired with its discriminator.
 */
export type BackendStorage = {
  backend: StorageBackend;
  storage: PortalStorage;
};

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
export function parsePortalConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PortalConfig | null {
  const enabled = optionalBooleanEnv('CP_PORTAL_ENABLED', env);
  if (!enabled) {
    return null;
  }

  const backendsStr = optionalEnv('CP_PORTAL_BACKENDS', env) ?? 'duckdb';
  const backends = backendsStr
    .split(',')
    .map(b => b.trim()) as StorageBackend[];

  return {
    backends,
    duckdbPath:
      optionalEnv('CP_PORTAL_DUCKDB_PATH', env) ?? DEFAULT_DUCKDB_PATH,
    icebergWarehousePath:
      optionalEnv('CP_PORTAL_ICEBERG_PATH', env) ?? DEFAULT_ICEBERG_PATH,
    doltdbPath:
      optionalEnv('CP_PORTAL_DOLTDB_PATH', env) ?? DEFAULT_DOLTDB_PATH,
    doltdbBranch:
      optionalEnv('CP_PORTAL_DOLTDB_BRANCH', env) ?? DEFAULT_DOLTDB_BRANCH,
  };
}

/**
 * Creates storage instances for all configured backends.
 *
 * The returned `BackendStorage` objects expose a `backend` discriminator
 * so callers can report which backend succeeded or failed.
 */
export function createPortalStorages(config: PortalConfig): BackendStorage[] {
  return config.backends.map(backend => ({
    backend,
    storage: createStorage(backend, config),
  }));
}

function createStorage(
  backend: StorageBackend,
  config: PortalConfig,
): PortalStorage {
  switch (backend) {
    case 'duckdb':
      return createDuckDBStorage(config.duckdbPath ?? DEFAULT_DUCKDB_PATH);
    case 'iceberg':
      return createIcebergStorage(
        config.icebergWarehousePath ?? DEFAULT_ICEBERG_PATH,
      );
    case 'doltdb':
      return createDoltDBStorage(
        config.doltdbPath ?? DEFAULT_DOLTDB_PATH,
        config.doltdbBranch ?? DEFAULT_DOLTDB_BRANCH,
      );
  }
}

/**
 * Closes all portal storage connections.
 */
export async function closePortalStorages(
  storages: BackendStorage[],
): Promise<void> {
  await Promise.allSettled(storages.map(s => s.storage.close()));
}

/**
 * Persists one or more `RunRecordInput`s to all configured portal backends.
 *
 * Initializes each backend (idempotent) and then writes the records.
 * Returns the per-backend save results so callers can report partial
 * failures.
 */
export async function saveToPortal(
  inputs: RunRecordInput[],
  context: RunContext,
  storages: BackendStorage[],
): Promise<PortalSaveResult[]> {
  if (storages.length === 0) {
    return [];
  }

  const records = buildRunRecords(inputs, context);
  const results: PortalSaveResult[] = [];

  for (const { backend, storage } of storages) {
    try {
      await storage.initialize();
      for (const record of records) {
        await storage.saveRun(record);
      }
      results.push({ backend, ok: true });
    } catch (error) {
      results.push({
        backend,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

export type PortalSaveResult = {
  backend: StorageBackend;
  ok: boolean;
  error?: string;
};
