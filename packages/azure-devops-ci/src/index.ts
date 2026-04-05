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

// Portal storage (DuckDB, Iceberg, DoltDB)
export {
  createDuckDBStorage,
  createIcebergStorage,
  createDoltDBStorage,
  parsePortalConfigFromEnv,
  createPortalStorages,
  saveRunToPortal,
  closePortalStorages,
  type RunRecord,
  type StorageBackend,
  type PortalConfig,
  type PortalQueryOptions,
  type PortalStorage,
} from './lib/portal/index.js';
