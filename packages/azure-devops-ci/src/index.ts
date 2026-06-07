// REST API client
export {
  createAzureDevOpsAPIClient,
  createAzureDevOpsAPIClientFromEnv,
  parseCollectionUri,
  type AzureDevOpsAPIClientConfig,
} from './lib/api.js';

// CLI adapters (az CLI, vsts CLI)
export {
  createAzCLIClient,
  createVstsCLIClient,
  COMMAND_MAPPINGS,
  translateVstsToAz,
  translateAzToVsts,
  getMappingsForNamespace,
  type AzureDevOpsBackend,
  type CLIAdapterConfig,
  type CommandMapping,
} from './lib/cli-adapters/index.js';

// Git refs and options
export { parseGitRefs, isPullRequestPipeline } from './lib/refs.js';
export { parseOptionsFromEnv } from './lib/options.js';

// Run orchestration
export { run, runWithConfig } from './lib/run.js';

// PR status checks
export {
  setPullRequestStatus,
  type PullRequestStatus,
  type PullRequestStatusState,
  type PullRequestStatusContext,
} from './lib/status.js';

// Portal storage (DuckDB, Iceberg, DoltDB) — implementation lives in
// @code-pushup/collect-plugin and is re-exported here for backwards
// compatibility with existing consumers.
export {
  createDuckDBStorage,
  createIcebergStorage,
  createDoltDBStorage,
  parsePortalConfigFromEnv,
  createPortalStorages,
  saveToPortal,
  closePortalStorages,
  type PortalConfig,
  type PortalQueryOptions,
  type PortalStorage,
  type PortalSaveResult,
  type RunRecord,
  type RunSource,
  type StorageBackend,
} from '@code-pushup/collect-plugin';

// Legacy alias: the old name `saveRunToPortal` was tied to the
// `RunResult` shape from `@code-pushup/ci`. Existing consumers can still
// import it; it now delegates to `saveToPortal` after translating
// `RunResult` into `RunRecordInput[]`.
export { saveRunToPortal } from './lib/portal-compat.js';
