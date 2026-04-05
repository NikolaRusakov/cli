import type { PortalQueryOptions, PortalStorage, RunRecord } from './types.js';

/**
 * DuckDB storage backend for Code PushUp run results.
 *
 * Stores run data in a local DuckDB database file for fast analytical queries.
 * DuckDB is an embedded analytical database (like SQLite but column-oriented),
 * making it ideal for querying historical run data.
 *
 * Features:
 * - Columnar storage for efficient analytical queries
 * - JSON column support for raw report data
 * - SQL interface for ad-hoc analysis
 * - No server required (embedded)
 *
 * Requires: `duckdb` npm package (peer dependency)
 */
export function createDuckDBStorage(dbPath: string): PortalStorage {
  let db: DuckDBInstance | null = null;

  async function getDB(): Promise<DuckDBInstance> {
    if (db) {
      return db;
    }

    try {
      const duckdb = await import('duckdb');
      db = new duckdb.default.Database(dbPath) as DuckDBInstance;
      return db;
    } catch {
      throw new Error(
        'DuckDB is required for portal storage. Install it with: npm install duckdb',
      );
    }
  }

  function runQuery(
    database: DuckDBInstance,
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

  function runExec(database: DuckDBInstance, sql: string): Promise<void> {
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

  async function initialize(): Promise<void> {
    const database = await getDB();

    await runExec(
      database,
      `
      CREATE TABLE IF NOT EXISTS code_pushup_runs (
        id              VARCHAR PRIMARY KEY,
        timestamp       TIMESTAMP NOT NULL,
        commit_sha      VARCHAR NOT NULL,
        branch          VARCHAR NOT NULL,
        pull_request_id INTEGER,
        project         VARCHAR,
        mode            VARCHAR NOT NULL,
        duration_ms     INTEGER NOT NULL,
        score           DOUBLE,
        report_json     JSON NOT NULL,
        diff_json       JSON,
        new_issues_count INTEGER NOT NULL DEFAULT 0,
        organization    VARCHAR NOT NULL,
        az_project      VARCHAR NOT NULL,
        repository      VARCHAR NOT NULL,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_runs_branch
        ON code_pushup_runs (branch);

      CREATE INDEX IF NOT EXISTS idx_runs_timestamp
        ON code_pushup_runs (timestamp);

      CREATE INDEX IF NOT EXISTS idx_runs_project
        ON code_pushup_runs (project);

      CREATE INDEX IF NOT EXISTS idx_runs_commit
        ON code_pushup_runs (commit_sha);
      `,
    );
  }

  async function saveRun(record: RunRecord): Promise<void> {
    const database = await getDB();

    await runQuery(
      database,
      `
      INSERT INTO code_pushup_runs (
        id, timestamp, commit_sha, branch, pull_request_id,
        project, mode, duration_ms, score, report_json,
        diff_json, new_issues_count, organization, az_project, repository
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        report_json = EXCLUDED.report_json,
        diff_json = EXCLUDED.diff_json,
        score = EXCLUDED.score,
        new_issues_count = EXCLUDED.new_issues_count
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
      ],
    );
  }

  async function queryRuns(
    options?: PortalQueryOptions,
  ): Promise<RunRecord[]> {
    const database = await getDB();
    const conditions: string[] = [];
    const params: unknown[] = [];

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

  async function close(): Promise<void> {
    if (db) {
      await new Promise<void>((resolve, reject) => {
        db!.close((err: Error | null) => {
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

  return { initialize, saveRun, queryRuns, getRun, close };
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
    reportJson: typeof row['report_json'] === 'string'
      ? row['report_json']
      : JSON.stringify(row['report_json']),
    diffJson: row['diff_json']
      ? typeof row['diff_json'] === 'string'
        ? row['diff_json']
        : JSON.stringify(row['diff_json'])
      : undefined,
    newIssuesCount: row['new_issues_count'] as number,
    organization: row['organization'] as string,
    azProject: row['az_project'] as string,
    repository: row['repository'] as string,
  };
}

/**
 * Minimal DuckDB type interface to avoid requiring the full type package.
 */
type DuckDBInstance = {
  all: (sql: string, ...params: unknown[]) => void;
  exec: (sql: string, callback: (err: Error | null) => void) => void;
  close: (callback: (err: Error | null) => void) => void;
};
