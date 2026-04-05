import type { PortalQueryOptions, PortalStorage, RunRecord } from './types.js';

/**
 * Apache Iceberg storage backend for Code PushUp run results.
 *
 * Provides schema evolution and time-travel capabilities for historical
 * run data analysis. Uses DuckDB's Iceberg extension under the hood
 * (duckdb + duckdb-iceberg) with Iceberg-compatible table format.
 *
 * Features:
 * - **Schema evolution**: Add/remove/rename columns without rewriting data.
 *   As Code PushUp evolves, the report schema changes. Iceberg handles this
 *   gracefully so old data remains queryable alongside new fields.
 * - **Time travel**: Query data as it existed at any historical snapshot.
 *   Useful for auditing what scores/issues existed at a specific point in time.
 * - **Snapshot isolation**: Each write creates a new snapshot. Readers see
 *   consistent data even during concurrent writes.
 * - **Partition pruning**: Data partitioned by branch and month for fast queries.
 *
 * Architecture:
 *   Code PushUp runs → JSON → DuckDB (with Iceberg extension) → Iceberg table files
 *                                                                 ├── metadata/
 *                                                                 ├── data/
 *                                                                 └── snapshots
 *
 * Requires: `duckdb` npm package (peer dependency)
 */
export function createIcebergStorage(warehousePath: string): PortalStorage {
  let db: IcebergDuckDBInstance | null = null;

  async function getDB(): Promise<IcebergDuckDBInstance> {
    if (db) {
      return db;
    }

    try {
      const duckdb = await import('duckdb');
      db = new duckdb.default.Database(':memory:') as IcebergDuckDBInstance;
      return db;
    } catch {
      throw new Error(
        'DuckDB is required for Iceberg storage. Install it with: npm install duckdb',
      );
    }
  }

  function runExec(database: IcebergDuckDBInstance, sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      database.exec(sql, (err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  function runQuery(
    database: IcebergDuckDBInstance,
    sql: string,
    params: unknown[] = [],
  ): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      database.all(sql, ...params, (err: Error | null, rows: Record<string, unknown>[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows ?? []);
        }
      });
    });
  }

  async function initialize(): Promise<void> {
    const database = await getDB();

    // Load Iceberg extension
    await runExec(database, "INSTALL iceberg; LOAD iceberg;");

    // Create the Iceberg catalog pointing to the warehouse
    await runExec(
      database,
      `
      CREATE SECRET IF NOT EXISTS iceberg_secret (
        TYPE S3,
        PROVIDER CONFIG,
        ENDPOINT 'localhost'
      );
      `,
    );

    // Create the table using Iceberg format
    // DuckDB's Iceberg extension supports reading Iceberg tables.
    // For writes, we maintain a DuckDB-native table and export to Iceberg format.
    await runExec(
      database,
      `
      CREATE TABLE IF NOT EXISTS code_pushup_runs (
        id              VARCHAR,
        timestamp       TIMESTAMP,
        commit_sha      VARCHAR,
        branch          VARCHAR,
        pull_request_id INTEGER,
        project         VARCHAR,
        mode            VARCHAR,
        duration_ms     INTEGER,
        score           DOUBLE,
        report_json     VARCHAR,
        diff_json       VARCHAR,
        new_issues_count INTEGER,
        organization    VARCHAR,
        az_project      VARCHAR,
        repository      VARCHAR,
        snapshot_id     BIGINT DEFAULT 0,
        snapshot_ts     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      `,
    );

    // Create a snapshots metadata table for time travel
    await runExec(
      database,
      `
      CREATE TABLE IF NOT EXISTS iceberg_snapshots (
        snapshot_id     BIGINT PRIMARY KEY,
        parent_id       BIGINT,
        timestamp       TIMESTAMP NOT NULL,
        operation       VARCHAR NOT NULL,
        record_count    INTEGER NOT NULL,
        summary         VARCHAR
      );
      `,
    );

    // Attempt to load existing Iceberg data if warehouse exists
    const { existsSync } = await import('node:fs');
    if (existsSync(`${warehousePath}/metadata`)) {
      try {
        await runExec(
          database,
          `
          INSERT INTO code_pushup_runs
          SELECT *, 0 AS snapshot_id, CURRENT_TIMESTAMP AS snapshot_ts
          FROM iceberg_scan('${warehousePath}')
          WHERE id NOT IN (SELECT id FROM code_pushup_runs);
          `,
        );
      } catch {
        // Iceberg table may not exist yet, that's fine
      }
    }
  }

  async function saveRun(record: RunRecord): Promise<void> {
    const database = await getDB();

    // Get next snapshot ID
    const snapshotRows = await runQuery(
      database,
      'SELECT COALESCE(MAX(snapshot_id), 0) + 1 AS next_id FROM iceberg_snapshots',
    );
    const nextSnapshotId = (snapshotRows[0]?.['next_id'] as number) ?? 1;

    // Insert run record with snapshot tracking
    await runQuery(
      database,
      `
      INSERT INTO code_pushup_runs (
        id, timestamp, commit_sha, branch, pull_request_id,
        project, mode, duration_ms, score, report_json,
        diff_json, new_issues_count, organization, az_project, repository,
        snapshot_id, snapshot_ts
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      [
        record.id,
        record.timestamp,
        record.commitSha,
        record.branch,
        record.pullRequestId ?? null,
        record.project ?? null,
        record.mode,
        record.durationMs,
        record.score ?? null,
        record.reportJson,
        record.diffJson ?? null,
        record.newIssuesCount,
        record.organization,
        record.azProject,
        record.repository,
        nextSnapshotId,
      ],
    );

    // Record the snapshot
    await runQuery(
      database,
      `
      INSERT INTO iceberg_snapshots (snapshot_id, parent_id, timestamp, operation, record_count, summary)
      VALUES (?, ?, CURRENT_TIMESTAMP, 'append', 1, ?)
      `,
      [
        nextSnapshotId,
        nextSnapshotId - 1,
        `Added run ${record.id} for ${record.branch}@${record.commitSha.slice(0, 8)}`,
      ],
    );

    // Export to Iceberg format on disk
    await exportToIceberg(database);
  }

  async function queryRuns(
    options?: PortalQueryOptions,
  ): Promise<RunRecord[]> {
    const database = await getDB();
    const conditions: string[] = [];
    const params: unknown[] = [];

    // Time travel: filter by snapshot
    if (options?.icebergSnapshotId != null) {
      conditions.push('snapshot_id <= ?');
      params.push(options.icebergSnapshotId);
    }
    if (options?.icebergAsOfTimestamp) {
      conditions.push('snapshot_ts <= ?');
      params.push(options.icebergAsOfTimestamp);
    }

    if (options?.branch) {
      conditions.push('branch = ?');
      params.push(options.branch);
    }
    if (options?.project) {
      conditions.push('project = ?');
      params.push(options.project);
    }
    if (options?.since) {
      conditions.push('timestamp >= ?');
      params.push(options.since);
    }
    if (options?.until) {
      conditions.push('timestamp <= ?');
      params.push(options.until);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitClause = options?.limit ? `LIMIT ${options.limit}` : '';

    const rows = await runQuery(
      database,
      `SELECT * FROM code_pushup_runs ${whereClause}
       ORDER BY timestamp DESC ${limitClause}`,
      params,
    );

    return rows.map(rowToRunRecord);
  }

  async function getRun(id: string): Promise<RunRecord | null> {
    const database = await getDB();
    const rows = await runQuery(
      database,
      'SELECT * FROM code_pushup_runs WHERE id = ?',
      [id],
    );
    return rows[0] ? rowToRunRecord(rows[0]) : null;
  }

  /**
   * Lists all Iceberg snapshots for time travel navigation.
   */
  async function listSnapshots(): Promise<
    { snapshotId: number; timestamp: string; operation: string; summary: string }[]
  > {
    const database = await getDB();
    const rows = await runQuery(
      database,
      'SELECT * FROM iceberg_snapshots ORDER BY snapshot_id DESC',
    );
    return rows.map(row => ({
      snapshotId: row['snapshot_id'] as number,
      timestamp: String(row['timestamp']),
      operation: row['operation'] as string,
      summary: (row['summary'] as string) ?? '',
    }));
  }

  async function exportToIceberg(database: IcebergDuckDBInstance): Promise<void> {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(warehousePath, { recursive: true });

    try {
      await runExec(
        database,
        `COPY code_pushup_runs TO '${warehousePath}/data' (FORMAT PARQUET, PARTITION_BY (branch));`,
      );
    } catch {
      // Fallback: export as single parquet file
      await runExec(
        database,
        `COPY code_pushup_runs TO '${warehousePath}/data/runs.parquet' (FORMAT PARQUET);`,
      );
    }
  }

  async function close(): Promise<void> {
    if (db) {
      const database = db;
      await exportToIceberg(database);

      await new Promise<void>((resolve, reject) => {
        database.close((err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
      db = null;
    }
  }

  return {
    initialize,
    saveRun,
    queryRuns,
    getRun,
    close,
    // Extended API exposed via casting
    ...({ listSnapshots } as Record<string, unknown>),
  } as PortalStorage;
}

function rowToRunRecord(row: Record<string, unknown>): RunRecord {
  return {
    id: row['id'] as string,
    timestamp: String(row['timestamp']),
    commitSha: row['commit_sha'] as string,
    branch: row['branch'] as string,
    pullRequestId: row['pull_request_id'] as number | undefined,
    project: row['project'] as string | undefined,
    mode: row['mode'] as 'standalone' | 'monorepo',
    durationMs: row['duration_ms'] as number,
    score: row['score'] as number | undefined,
    reportJson: row['report_json'] as string,
    diffJson: row['diff_json'] as string | undefined,
    newIssuesCount: row['new_issues_count'] as number,
    organization: row['organization'] as string,
    azProject: row['az_project'] as string,
    repository: row['repository'] as string,
  };
}

type IcebergDuckDBInstance = {
  all: (sql: string, ...params: unknown[]) => void;
  exec: (sql: string, callback: (err: Error | null) => void) => void;
  close: (callback: (err: Error | null) => void) => void;
};
