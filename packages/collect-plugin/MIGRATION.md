# Migration guide: pre-`@code-pushup/collect-plugin` data

The `@code-pushup/collect-plugin` package introduced two schema changes to
the `RunRecord` shape (and the corresponding storage tables):

1. The `azProject` field was renamed to `providerProject`. This was a
   typing/clarity change — it was always meant to be "the provider's
   project ID" (e.g. an Azure DevOps project), not Azure-DevOps-specific.
2. A new `source: 'local' | 'ci'` discriminator was added so we can tell
   apart runs collected on a developer machine from runs collected in CI.

The new code **reads both column names** (`provider_project` and
`az_project`) on the read path, so existing rows are still queryable. On
the write path, only the new column is written.

This document describes the **one-time on-disk migration** for users who
have rows in their storage tables from a previous version.

## In-process migration

If you have `RunRecord` objects in memory (e.g. loaded from a snapshot
or from a JSON file), use the migration helper:

```ts
import { type LegacyRunRecord, migrateRunRecords } from '@code-pushup/collect-plugin';

const legacy: LegacyRunRecord[] = JSON.parse(fs.readFileSync('runs.json', 'utf8'));
const migrated = migrateRunRecords(legacy);
// migrated[0].source === 'ci'   (defaulted)
// migrated[0].providerProject   (was azProject)
```

## On-disk migration

### DuckDB

```sql
-- 1. Add the new columns.
ALTER TABLE code_pushup_runs ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'ci';

-- DuckDB does not support nullable column renames pre-emptively without
-- a workaround. We add the new column nullable, copy data, then enforce.
ALTER TABLE code_pushup_runs ADD COLUMN provider_project VARCHAR;

-- 2. Copy data from the old column.
UPDATE code_pushup_runs
   SET provider_project = az_project
 WHERE provider_project IS NULL
   AND az_project IS NOT NULL;

-- 3. (Optional) Drop the old column. DuckDB does not support DROP COLUMN
-- in all versions; if you need to keep the column for a grace period,
-- skip this step and rely on the read-side fallback in rowToRunRecord.
-- ALTER TABLE code_pushup_runs DROP COLUMN az_project;
```

### Apache Iceberg

Iceberg is append-only by design. To migrate an existing warehouse, you
have two options:

1. **Re-scan and re-write.** A fresh storage will pick up old rows because
   the read path falls back to `az_project`. New writes go to
   `provider_project`. Leave both columns in the schema; the read-side
   fallback ensures old rows are still queryable.
2. **Rewrite the warehouse.** Run a one-time script that reads every row
   via the storage, runs `migrateRunRecord`, and writes it back. The
   `id` is stable, so the existing `INSERT ... ON CONFLICT DO UPDATE`
   in DuckDB (or `REPLACE INTO` in DoltDB) makes this idempotent.

### DoltDB

Dolt is MySQL-compatible, so the same SQL works:

```sql
ALTER TABLE code_pushup_runs ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'ci';
ALTER TABLE code_pushup_runs ADD COLUMN provider_project VARCHAR(255);
UPDATE code_pushup_runs
   SET provider_project = az_project
 WHERE provider_project IS NULL
   AND az_project IS NOT NULL;

dolt add .
dolt commit -m "migrate code_pushup_runs to provider_project"
```

## Backward-compat matrix

| Operation            | Pre-`azProject` rows             | `azProject` rows                                       | New rows                      |
| -------------------- | -------------------------------- | ------------------------------------------------------ | ----------------------------- |
| `queryRuns()` reads  | surface `providerProject = null` | surface `providerProject` (via `?? az_project`)        | surface `providerProject`     |
| `saveRun()` writes   | (no migration needed)            | writes `providerProject` only                          | writes `providerProject` only |
| `migrateRunRecord()` | adds `source: 'ci'`              | adds `source`, renames `azProject` → `providerProject` | passes through                |

## When to migrate

You can defer the on-disk migration indefinitely — the new code reads
both columns. The only reason to migrate is to clean up legacy data or
to take advantage of new schema features (e.g. `source`-based filters).
