# ADR-0001: Local Portal Storage as a Real Code PushUp Plugin

- **Status**: Accepted
- **Date**: 2026-06-05
- **Deciders**: code-pushup-cli maintainers
- **Related packages**: `@code-pushup/collect-plugin` (new), `@code-pushup/azure-devops-ci` (refactored), `@code-pushup/models` (extended), `@code-pushup/core` (extended)

## Context

Code PushUp runs audits through a `PluginConfig` pipeline. A plugin is a `RunnerFunction` that returns `AuditOutputs`; `executePlugins()` aggregates those into a `Report`, which the CLI persists to disk (JSON / Markdown) and (optionally) uploads to a hosted portal.

Some users wanted to keep a **local** history of reports — not the hosted portal, but a queryable database living in the repo / on the CI agent. The `@code-pushup/azure-devops-ci` package already had the building blocks for this (DuckDB / Iceberg / DoltDB), but the storage layer was bolted onto the Azure DevOps runner via `CP_PORTAL_*` env vars and was unreachable from a vanilla `code-pushup collect` invocation.

The user-facing problem:

> "I want a plugin that stores results in different databases when run locally. Extend the plugin system so it integrates with Azure DevOps as a plugin."

Three constraints shaped the decision:

1. The user requested a **real Code PushUp plugin** (not a new "sink" abstraction). A plugin runs during collect, alongside the other plugins.
2. The user wanted **the same database backends** (DuckDB / Apache Iceberg / DoltDB) that already exist in `@code-pushup/azure-devops-ci`. No new storage engines.
3. The user wanted the **Azure DevOps CI flow to use the same code** so the two paths cannot drift.

The plugin system also had a related but separate deficiency: there was no way for a `RunnerFunction` to read options the user passed to the plugin factory. The runner received only `{ persist: PersistConfig }`. To pass per-plugin options (e.g. which backends to enable, where to write the `.duckdb`), we needed a new mechanism.

## Decision

### 1. New package: `@code-pushup/collect-plugin`

A first-class Code PushUp plugin that persists each `report.json` produced by `code-pushup collect` to one or more local databases.

```ts
// code-pushup.config.ts
import collectPlugin from '@code-pushup/collect-plugin';

export default {
  plugins: [
    collectPlugin({
      backends: ['duckdb', 'iceberg'],
      duckdbPath: '.code-pushup/portal.duckdb',
    }),
  ],
};
```

The plugin produces a single `persist-runs` audit with `score: 1` when every configured backend accepted the record and `score: 0` when persistence was skipped (e.g. no git commit available, or no `report.json`).

### 2. Storage layer is lifted out of `@code-pushup/azure-devops-ci`

The three backends (`duckdb-storage.ts`, `iceberg-storage.ts`, `doltdb-storage.ts`), the `PortalStorage` interface, and the `RunRecord` schema all move into `@code-pushup/collect-plugin/src/lib/storages/`. `@code-pushup/azure-devops-ci` re-exports them so existing consumers (`createDuckDBStorage`, etc.) keep working unchanged.

### 3. New `RunRecord` schema with backward-compat read path

The storage tables already renamed `az_project` → `provider_project` and added a `source: 'local' | 'ci'` column. The new code **reads** both `provider_project` and `az_project` (`rowToRunRecord` falls back: `provider_project ?? az_project`). A `MIGRATION.md` and a programmatic `migrateRunRecord()` helper cover the write-side (one-time SQL `UPDATE`) and the consumer-side (in-process shape conversion).

### 4. New `pluginContext` field on `RunnerArgs`

The runner contract was extended (non-breaking, additive) to carry a `PluginContext` from the plugin factory to the runner:

```ts
// packages/models/src/lib/runner-config.ts
export const runnerArgsSchema = z.object({
  persist: persistConfigSchema.required().meta({...}),
  pluginContext: pluginContextSchema.meta({...}),  // <-- new
});
```

`@code-pushup/core` was extended so `executePlugin()` copies `PluginConfig.context` into `RunnerArgs.pluginContext`. The plugin then round-trips its options through the runner by stuffing them into `context` (using `PORTAL_CONTEXT_KEY` constants exported from the new package) and reading them back via `readContextOptions()`.

### 5. Single source of truth, two consumers

Both `@code-pushup/collect-plugin` (local runs) and `@code-pushup/azure-devops-ci` (CI runs) call the same `saveToPortal(inputs, context, storages)` from `@code-pushup/collect-plugin`. The ADo runner builds a `BackendStorage[]` once, then passes it (and the inputs) to `saveToPortal`; the local plugin does the same. A thin `portal-compat.ts` shim in ADo preserves the legacy `saveRunToPortal(result, …)` signature for any consumer that was already calling it.

## Alternatives Considered

### A. New "report sink" abstraction

Add a third concept alongside `PluginConfig` and `RunnerConfig`: a list of `sinks` that execute _after_ `executePlugins()` and receive the full `Report`. Sinks could be `UploadSink`, `PortalSink`, `EmailSink`, etc.

**Rejected** because:

- It introduces a new concept that has to be supported by the CLI, the models package, the upload flow, and every CI runner. The user explicitly asked for a "real Code PushUp plugin" — they wanted discoverability through `code-pushup.config.ts`, integration with the existing `plugins: [...]` array, and the same runner pipeline as every other plugin.
- The "sink" pattern doesn't compose with the rest of the plugin system (no runner invocation, no audit outputs, no `groups`).

### B. Config-driven (no new package)

Add a CLI flag `--portal-backend=duckdb` and have the CLI itself do the persistence.

**Rejected** because:

- It bypasses the plugin system entirely, so users can't extend it (custom backends, custom paths per project, etc.).
- The "right" way to add new behavior in Code PushUp is "write a plugin." Anything else creates a privileged path that diverges.

### C. Different storage engines

Add SQLite / MongoDB / Postgres / etc.

**Rejected** because:

- The user requested the same engines that already exist in ADo.
- Three engines are enough to demonstrate the plugin contract; adding more is a follow-up that doesn't require any new architectural decisions.

### D. Keep the storage layer in ADo and re-export

Keep the storage layer in `@code-pushup/azure-devops-ci`, and have `@code-pushup/collect-plugin` import from there.

**Rejected** because:

- It reverses the dependency direction. A consumer of `@code-pushup/collect-plugin` who never uses Azure DevOps would be forced to install `@code-pushup/azure-devops-ci` and its CLI peer-dependencies.
- ADo is a CI integration; it should depend on the plugin contract, not the other way around.

## Consequences

### Positive

- A user can drop `collectPlugin()` into their `code-pushup.config.ts` and have a local DuckDB of every collect run with zero extra setup.
- The same `RunRecord` schema is written by both local and CI runs, so a downstream query (dashboards, history, trend analysis) sees a single unified dataset.
- A single test (the ADo `run.int.test.ts`) proves that the CI runner hits the same `saveToPortal` code path the local plugin uses.
- `PluginConfig.context` is now a general-purpose mechanism for any plugin that needs to round-trip options to its runner. Future plugins can use the same pattern.

### Negative / Trade-offs

- **`RunRecord` was generalized**. The previous `azProject: string` (required) became `providerProject?: string` (optional) and the column was renamed in the storage tables. Consumers with old data need a one-time migration (covered by `MIGRATION.md` and `migrateRunRecord`).
- **The new `pluginContext` field is a public API change** to the model layer. It is additive and non-breaking, but downstream plugin authors now have a new convention to follow if they want to round-trip options.
- **Linting uncovered a long-standing ADo lint debt**. The new package inherits a clean eslint config, but the ADo package hadn't run lint before; running it surfaces ~20 pre-existing errors that are unrelated to the new code. These are fixed in the same PR to keep the package clean.
- **DoltDB integration test is gated** on the `dolt` CLI being on `PATH`. The earlier attempt to gate on `DOLT_ROOT_DIR` env isolation revealed a vitest subprocess state-leak; the new test uses explicit `DOLT_ROOT_DIR` set/unset in `beforeEach`/`afterEach` to avoid that.
- **The new `persist-runs` audit is somewhat artificial** (it doesn't represent a real audit of the codebase, it represents a side effect of the runner). An alternative would have been to skip the audit shape entirely, but that would have meant inventing a new runner contract. We chose the existing `AuditOutput` shape and accept the conceptual awkwardness.

## Implementation Notes

### Storage layer

The three backends share a `PortalStorage` interface and a `RunRecord` shape:

```ts
type RunRecord = {
  id: string;
  timestamp: string;
  commitSha: string;
  branch: string;
  pullRequestId?: number;
  project?: string;
  mode: 'standalone' | 'monorepo';
  durationMs: number;
  score?: number;
  reportJson: string;
  diffJson?: string;
  newIssuesCount: number;
  source: 'local' | 'ci';
  organization?: string;
  providerProject?: string; // renamed from azProject
  repository?: string;
};
```

DuckDB and Iceberg use a SQL table with a `JSON` / `VARCHAR` `report_json` column and a regular schema. DoltDB uses the same table layout but is MySQL-compat. The `az_project` → `provider_project` rename is paired with a `?? az_project` fallback in `rowToRunRecord` so old data is still queryable.

### Plugin context round-trip

```ts
const PORTAL_CONTEXT_KEY = {
  backends: 'backends',
  duckdbPath: 'duckdbPath',
  // ... etc
} as const;

export function collectPlugin(options): PluginConfig {
  return {
    ...,
    context: {
      [PORTAL_CONTEXT_KEY.backends]: options.backends ?? null,
      [PORTAL_CONTEXT_KEY.duckdbPath]: options.duckdbPath ?? null,
      // ... etc
    },
    runner: createRunnerFunction(),
  };
}

export function createRunnerFunction(): RunnerFunction {
  return async (args) => {
    const opts = readContextOptions(args.pluginContext); // narrow unknown → typed
    const resolved = resolvePortalOptions(opts);          // merge with env
    // ... persist via createPortalStorages + saveToPortal
  };
}
```

### `executePlugin` change in `@code-pushup/core`

```ts
const args: RunnerArgs = {
  persist: { ...DEFAULT_PERSIST_CONFIG, ...opt.persist },
  ...(context !== undefined && { pluginContext: context }),
};
```

The `...(context !== undefined && { pluginContext: context })` spread preserves the pre-existing `toHaveBeenCalledWith({ persist: ... })` test contract: when a plugin has no context, the runner is called with `{ persist: ... }` only, identical to before.

### Backward-compat in ADo

```ts
// azure-devops-ci/src/lib/portal-compat.ts
export async function saveRunToPortal(result: RunResult, context: { commitSha; branch; pullRequestId?; organization; azProject; repository; startTime }, storages: PortalStorage[] | BackendStorage[]): Promise<void> {
  // translate RunResult → RunRecordInput[]
  // translate azProject → providerProject in RunContext
  // accept both PortalStorage[] and BackendStorage[] (legacy + new)
  await saveToPortal(inputs, ctx, normalizedStorages);
}
```

This shim is the only public API change for existing ADo consumers.

### Migration

`packages/collect-plugin/src/lib/migration.ts` exposes:

```ts
export type LegacyRunRecord = Omit<RunRecord, 'providerProject' | 'source'> & {
  azProject?: string;
  source?: 'local' | 'ci';
};

export function migrateRunRecord(legacy: LegacyRunRecord): RunRecord;
export function migrateRunRecords(legacy: LegacyRunRecord[]): RunRecord[];
```

`MIGRATION.md` provides the SQL to add the `provider_project` and `source` columns to existing storage tables and copy data from `az_project`.

## Testing Strategy

The full test plan is documented separately in the rev-2 plan response, summarized:

- **Unit** — `config`, `portal`, `record`, `runner`, `git`, `portal-plugin` plus property-based tests for `readContextOptions` and `buildRunRecords` using `fast-check`.
- **Integration** — DuckDB (round-trip + upsert), Iceberg (round-trip + time travel), DoltDB (round-trip, gated on `dolt` CLI), ADo `run.int.test.ts` (mocked `runInCI` + real DuckDB on disk), and a multi-backend case for the plugin.
- **E2E** — `e2e/collect-plugin-e2e/` mirroring `e2e/plugin-eslint-e2e/`, running the real CLI against a real config and verifying a DuckDB file is produced.
- **Backward-compat** — `migration.unit.test.ts` plus an int test that simulates a legacy `az_project` row and asserts it surfaces correctly.
- **Lint** — pre-existing ADo lint failures fixed in the same PR.

Coverage targets (post-test):

| File                              | Target |
| --------------------------------- | ------ |
| `lib/config.ts`                   | 100%   |
| `lib/portal.ts`                   | 100%   |
| `lib/record.ts`                   | 100%   |
| `lib/runner.ts`                   | ≥ 95%  |
| `lib/portal-plugin.ts`            | 100%   |
| `lib/git.ts`                      | ≥ 90%  |
| `lib/migration.ts`                | 100%   |
| `lib/storages/duckdb-storage.ts`  | 100%   |
| `lib/storages/iceberg-storage.ts` | ≥ 90%  |
| `lib/storages/doltdb-storage.ts`  | ≥ 90%  |
| ADo `run.ts` portal block         | 100%   |
| ADo `portal-compat.ts`            | 100%   |

## References

- `packages/collect-plugin/README.md` — plugin user guide.
- `packages/collect-plugin/MIGRATION.md` — `azProject` → `providerProject` upgrade steps.
- `packages/azure-devops-ci/README.md` — updated env-var section, link to MIGRATION.
- `packages/models/docs/models-reference.md` — auto-generated reference (already includes `RunnerArgs.pluginContext` after the schema change).
- `code-pushup.preset.ts` — workspace dogfood: `configureCollectPlugin()` is wired into the root `code-pushup.config.ts`.
