/**
 * Portal storage types for persisting Code PushUp run results.
 *
 * Supports three storage backends:
 * - DuckDB: Analytical queries on run data (default)
 * - Apache Iceberg: Schema evolution and time travel for historical analysis
 * - DoltDB: Git-like versioning (branches, diffs, merges) for run data
 */

/**
 * A single Code PushUp run result persisted to the portal.
 */
export type RunRecord = {
  /** Unique run identifier */
  id: string;
  /** ISO 8601 timestamp of the run */
  timestamp: string;
  /** Git commit SHA */
  commitSha: string;
  /** Git branch name */
  branch: string;
  /** Pull request ID (if applicable) */
  pullRequestId?: number;
  /** Project name (for monorepo mode) */
  project?: string;
  /** Run mode: standalone or monorepo */
  mode: 'standalone' | 'monorepo';
  /** Duration in milliseconds */
  durationMs: number;
  /** Overall score (0-1) */
  score?: number;
  /** Raw JSON report from Code PushUp CLI */
  reportJson: string;
  /** Comparison diff JSON (if base branch comparison was done) */
  diffJson?: string;
  /** New issues found in this run */
  newIssuesCount: number;
  /** Azure DevOps organization */
  organization: string;
  /** Azure DevOps project */
  azProject: string;
  /** Azure DevOps repository */
  repository: string;
};

/**
 * Storage backend type.
 */
export type StorageBackend = 'duckdb' | 'iceberg' | 'doltdb';

/**
 * Portal configuration.
 */
export type PortalConfig = {
  /** Storage backend(s) to use. Can enable multiple simultaneously. */
  backends: StorageBackend[];
  /** Path to DuckDB database file */
  duckdbPath?: string;
  /** Path to Iceberg warehouse directory */
  icebergWarehousePath?: string;
  /** DoltDB connection string or directory */
  doltdbPath?: string;
  /** DoltDB branch name for writes (default: 'main') */
  doltdbBranch?: string;
};

/**
 * Query options for retrieving historical run data.
 */
export type PortalQueryOptions = {
  /** Filter by branch */
  branch?: string;
  /** Filter by project (monorepo) */
  project?: string;
  /** Filter by date range (ISO 8601) */
  since?: string;
  until?: string;
  /** Max results to return */
  limit?: number;
  /** For Iceberg: snapshot ID for time travel */
  icebergSnapshotId?: number;
  /** For Iceberg: timestamp for time travel (ISO 8601) */
  icebergAsOfTimestamp?: string;
  /** For DoltDB: branch name to query from */
  doltBranch?: string;
  /** For DoltDB: commit hash to query at */
  doltCommit?: string;
};

/**
 * Interface for portal storage backends.
 */
export type PortalStorage = {
  /** Initialize the storage (create tables, etc.) */
  initialize: () => Promise<void>;
  /** Persist a run record */
  saveRun: (record: RunRecord) => Promise<void>;
  /** Query run history */
  queryRuns: (options?: PortalQueryOptions) => Promise<RunRecord[]>;
  /** Get a specific run by ID */
  getRun: (id: string) => Promise<RunRecord | null>;
  /** Close connections and clean up */
  close: () => Promise<void>;
};
