# @code-pushup/collect-plugin

[Code PushUp](https://code-pushup.dev/) plugin that persists each `code-pushup collect` run to one or more local databases. The same storage layer is used by [`@code-pushup/azure-devops-ci`](https://github.com/code-pushup/cli/tree/main/packages/azure-devops-ci) for historical analysis in CI.

## Features

- **Drop-in Code PushUp plugin** — `collectPlugin()` returns a standard `PluginConfig` that runs alongside your other plugins during `code-pushup collect`.
- **Three storage backends**, all embedded (no external service required):
  - **DuckDB** — columnar analytical database, default backend
  - **Apache Iceberg** — schema evolution and time travel
  - **DoltDB** — git-like versioning (branches, diffs, merges) for run data
- **Multi-backend** — write to any combination simultaneously via `backends: ['duckdb', 'iceberg', 'doltdb']`.
- **Configurable via plugin options or env vars** (`CP_PORTAL_BACKENDS`, `CP_PORTAL_DUCKDB_PATH`, …) — same env-var contract used by `@code-pushup/azure-devops-ci`, so a single env-var config can power both local and CI runs.
- **CI-friendly** — `@code-pushup/azure-devops-ci` re-exports the same `createDuckDBStorage` / `createIcebergStorage` / `createDoltDBStorage` factories and uses the same persistence code, so behavior is identical locally and in CI.
- **No new audit semantics** — the plugin emits a single `persist-runs` audit whose `score` is `1` when every configured backend accepted the record and `0` if persistence was skipped (e.g. no git commit available).

## Installation

```bash
npm install --save-dev @code-pushup/collect-plugin
```

> **Optional peer dep:** DoltDB storage requires the `dolt` CLI on your `PATH`. Install it from [github.com/dolthub/dolt](https://github.com/dolthub/dolt).

## Quick start

Add the plugin to your `code-pushup.config.ts`:

```ts
import collectPlugin from '@code-pushup/collect-plugin';

export default {
  plugins: [
    // ...your other plugins...
    collectPlugin({
      backends: ['duckdb', 'iceberg'],
      // duckdbPath: '.code-pushup/portal.duckdb',         // default
      // icebergWarehousePath: '.code-pushup/iceberg-warehouse', // default
    }),
  ],
  // ...rest of config
};
```

Run collect as usual:

```bash
npx code-pushup collect
```

The just-collected report is written to `.code-pushup/portal.duckdb` (DuckDB) and `.code-pushup/iceberg-warehouse/` (Iceberg). Query it later with the same `createDuckDBStorage` / `createIcebergStorage` helpers:

```ts
import { createDuckDBStorage } from '@code-pushup/collect-plugin';

const storage = createDuckDBStorage('.code-pushup/portal.duckdb');
await storage.initialize();
const runs = await storage.queryRuns({ branch: 'main', limit: 10 });
console.log(runs);
```

## Configuration

### `PortalPluginOptions`

| Option                 | Type                                    | Default                                                        | Description                                  |
| ---------------------- | --------------------------------------- | -------------------------------------------------------------- | -------------------------------------------- |
| `backends`             | `('duckdb' \| 'iceberg' \| 'doltdb')[]` | `['duckdb']` (or `CP_PORTAL_BACKENDS`)                         | Storage backends to write to.                |
| `duckdbPath`           | `string`                                | `.code-pushup/portal.duckdb` (or `CP_PORTAL_DUCKDB_PATH`)      | DuckDB database file path.                   |
| `icebergWarehousePath` | `string`                                | `.code-pushup/iceberg-warehouse` (or `CP_PORTAL_ICEBERG_PATH`) | Iceberg warehouse directory.                 |
| `doltdbPath`           | `string`                                | `.code-pushup/doltdb` (or `CP_PORTAL_DOLTDB_PATH`)             | DoltDB repo directory.                       |
| `doltdbBranch`         | `string`                                | `main` (or `CP_PORTAL_DOLTDB_BRANCH`)                          | Branch to write to.                          |
| `commit`               | `{ sha: string; branch: string }`       | auto-detected via `git log`                                    | Override git commit/branch detection.        |
| `pullRequestId`        | `number`                                | —                                                              | Pull request ID (used when running from CI). |
| `organization`         | `string`                                | —                                                              | Provider organization (e.g. Azure DevOps).   |
| `providerProject`      | `string`                                | —                                                              | Provider project (e.g. Azure DevOps).        |
| `repository`           | `string`                                | —                                                              | Provider repository (e.g. Azure DevOps).     |
| `source`               | `'local' \| 'ci'`                       | `'local'`                                                      | Where the run was triggered.                 |
| `scoreTargets`         | `Record<string, number>`                | —                                                              | Map of audit slug → target score (0–1).      |

### Environment variables

The same options can be set via `CP_PORTAL_*` env vars. Plugin options take precedence; env vars are only used as fallback.

| Variable                  | Default                          | Description                                                                                                                               |
| ------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `CP_PORTAL_ENABLED`       | `false`                          | Reserved for back-compat with `@code-pushup/azure-devops-ci`. Has no effect on this plugin — persistence is opt-in via `collectPlugin()`. |
| `CP_PORTAL_BACKENDS`      | `duckdb`                         | Comma-separated backend list. Invalid values are dropped.                                                                                 |
| `CP_PORTAL_DUCKDB_PATH`   | `.code-pushup/portal.duckdb`     | DuckDB file path.                                                                                                                         |
| `CP_PORTAL_ICEBERG_PATH`  | `.code-pushup/iceberg-warehouse` | Iceberg warehouse directory.                                                                                                              |
| `CP_PORTAL_DOLTDB_PATH`   | `.code-pushup/doltdb`            | DoltDB repo directory.                                                                                                                    |
| `CP_PORTAL_DOLTDB_BRANCH` | `main`                           | DoltDB branch for writes.                                                                                                                 |

## Storage backends

### DuckDB (default)

Embedded columnar database for fast analytical queries. No server required.

```ts
import { createDuckDBStorage } from '@code-pushup/collect-plugin';

const storage = createDuckDBStorage('./portal.duckdb');
await storage.initialize();
const runs = await storage.queryRuns({ branch: 'main', limit: 10 });
```

Schema: a single `code_pushup_runs` table with indexes on `branch`, `timestamp`, `project`, `commit_sha`.

### Apache Iceberg

Schema evolution and time travel for historical analysis. Handles report schema changes gracefully as Code PushUp evolves.

```ts
import { createIcebergStorage } from '@code-pushup/collect-plugin';

const storage = createIcebergStorage('./iceberg-warehouse');
await storage.initialize();

// Time travel: query data as of a specific snapshot
const runs = await storage.queryRuns({
  icebergSnapshotId: 42,
  branch: 'main',
});

// Or query as of a specific timestamp
const historicalRuns = await storage.queryRuns({
  icebergAsOfTimestamp: '2026-01-15T00:00:00Z',
});
```

### DoltDB

Git-like versioning for run data — branches, diffs, merges, and time travel directly at the data layer.

```ts
import { createDoltDBStorage } from '@code-pushup/collect-plugin';

const storage = createDoltDBStorage('./doltdb', 'main');
await storage.initialize();

// Query from a specific Dolt branch
const runs = await storage.queryRuns({ doltBranch: 'analysis/q1' });

// Time travel to a specific Dolt commit
const historicalRuns = await storage.queryRuns({ doltCommit: 'abc123' });
```

Requires the [`dolt`](https://github.com/dolthub/dolt) CLI on `PATH`.

## Querying the data

All three backends implement the same `PortalStorage` interface:

```ts
type PortalStorage = {
  initialize: () => Promise<void>;
  saveRun: (record: RunRecord) => Promise<void>;
  queryRuns: (options?: PortalQueryOptions) => Promise<RunRecord[]>;
  getRun: (id: string) => Promise<RunRecord | null>;
  close: () => Promise<void>;
};
```

```ts
type RunRecord = {
  id: string;
  timestamp: string; // ISO 8601
  commitSha: string;
  branch: string;
  pullRequestId?: number;
  project?: string;
  mode: 'standalone' | 'monorepo';
  durationMs: number;
  score?: number;
  reportJson: string; // JSON-serialized Report
  diffJson?: string;
  newIssuesCount: number;
  source: 'local' | 'ci';
  organization?: string;
  providerProject?: string;
  repository?: string;
};
```

### Common query options

```ts
await storage.queryRuns({
  branch: 'main', // filter by branch
  project: 'pkg-a', // filter by monorepo project
  since: '2026-01-01T00:00:00Z', // ISO 8601 lower bound
  until: '2026-12-31T23:59:59Z', // ISO 8601 upper bound
  limit: 50,
});
```

## CI integration

`@code-pushup/azure-devops-ci` re-exports the same factories, types, and `saveToPortal` function. Persistence code is shared between local and CI runs, so the env-var contract is the same:

```yaml
# azure-pipelines.yml
- script: npx @code-pushup/azure-devops-ci
  env:
    CP_AZURE_TOKEN: $(System.AccessToken)
    CP_PORTAL_ENABLED: true
    CP_PORTAL_BACKENDS: duckdb,doltdb
    CP_PORTAL_DUCKDB_PATH: .code-pushup/portal.duckdb
    CP_PORTAL_DOLTDB_PATH: .code-pushup/doltdb
```

When you set `CP_PORTAL_ENABLED=true` in the CI run, Azure DevOps re-uses the same DuckDB / Iceberg / DoltDB backends that you can also write to locally with `collectPlugin()`.

## Programmatic API

The same building blocks used by the plugin are exported for custom integrations:

```ts
import { type RunContext, type RunRecordInput, closePortalStorages, createPortalStorages, parsePortalConfigFromEnv, saveToPortal } from '@code-pushup/collect-plugin';

const config = parsePortalConfigFromEnv();
const storages = createPortalStorages(config!);

try {
  await saveToPortal(
    [
      {
        mode: 'standalone',
        reportJson: JSON.stringify(myReport),
      },
    ],
    {
      commitSha: '...',
      branch: 'main',
      source: 'ci',
      startTime: Date.now(),
    },
    storages,
  );
} finally {
  await closePortalStorages(storages);
}
```

## Related

- [`@code-pushup/azure-devops-ci`](../azure-devops-ci#readme) — Azure DevOps CI integration that re-uses this storage layer.
- [`@code-pushup/ci`](../ci#readme) — Platform-agnostic CI runner.
- [`@code-pushup/models`](../models#readme) — Shared data models.

## Testing

Run the unit and integration tests via Nx:

```bash
npx nx run collect-plugin:unit-test   # 79 tests, runs in <1s
npx nx run collect-plugin:int-test    # 9 tests, requires @duckdb/node-api; the
                                     # DoltDB test is gated on the `dolt` CLI
```

The unit tests cover:

- The `resolvePortalOptions` env-fallback merge logic.
- Property-based tests for `readContextOptions` (arbitrary `PluginContext`
  inputs always produce a value that passes `portalPluginOptionsSchema`).
- Property-based tests for `buildRunRecords` (id uniqueness, ISO
  timestamps, context propagation).
- Negative paths in the runner: malformed JSON, missing `report.json`,
  wrong types in `pluginContext`, partial `commit` objects, etc.
- The full `saveToPortal` pipeline using stubbed storages (so no
  embedded DB is required to verify the dispatch logic).

The integration tests cover:

- A real DuckDB round-trip with a tempdir-backed file.
- A real Iceberg round-trip (also tempdir, also a fresh `code_pushup_runs`
  parquet file). Skipped if `@duckdb/node-api` is not installed.
- A real DoltDB round-trip. Skipped if the `dolt` CLI is not on `PATH`.
- A multi-backend case where the runner is invoked end-to-end and
  queries both the DuckDB row and the on-disk Iceberg parquet files.

The end-to-end test in `e2e/collect-plugin-e2e/` runs the actual CLI
against a generated config and verifies a real DuckDB file is produced.
It requires the workspace's `nxv-verdaccio` local registry to be set
up (so `npx @code-pushup/cli` resolves to a built `cli` package).

### Coverage

The package targets ≥ 90% line coverage across the runner / config /
portal / migration modules and 100% on the storage modules. Coverage
is reported by `vitest --coverage` via the Nx target.

## Migration

If you have data in storage tables from a previous
`@code-pushup/azure-devops-ci` (pre-`@code-pushup/collect-plugin`),
see [MIGRATION.md](./MIGRATION.md) for the one-time migration steps
and the backward-compat `migrateRunRecord` / `migrateRunRecords`
helpers.
