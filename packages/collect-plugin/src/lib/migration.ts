import type { RunRecord, RunSource } from './storages/types.js';

/**
 * Shape of legacy rows that pre-date the `@code-pushup/collect-plugin`
 * rename of `azProject` → `providerProject` and the addition of the
 * `source` discriminator.
 *
 * Stored rows from older versions of `@code-pushup/azure-devops-ci` may
 * have an `azProject` field and no `source` field. Consumers can use
 * {@link migrateRunRecord} / {@link migrateRunRecords} to convert them
 * to the new shape in memory.
 *
 * For on-disk migration, see `MIGRATION.md` in the same package.
 */
export type LegacyRunRecord = Omit<RunRecord, 'providerProject' | 'source'> & {
  azProject?: string;
  source?: RunSource;
};

/**
 * Convert a single legacy record to the new {@link RunRecord} shape.
 *
 * - `source` defaults to `'ci'` (the only value produced by the
 *   pre-collect-plugin code path).
 * - `azProject` is renamed to `providerProject` if present.
 */
export function migrateRunRecord(legacy: LegacyRunRecord): RunRecord {
  const { azProject, source, ...rest } = legacy;
  return {
    ...rest,
    source: source ?? 'ci',
    ...(azProject !== undefined && { providerProject: azProject }),
  };
}

/**
 * Convert an array of legacy records.
 */
export function migrateRunRecords(legacy: LegacyRunRecord[]): RunRecord[] {
  return legacy.map(migrateRunRecord);
}
