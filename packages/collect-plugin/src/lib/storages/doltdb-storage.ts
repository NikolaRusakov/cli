/* eslint-disable functional/immutable-data, @typescript-eslint/consistent-type-assertions, n/no-sync, max-lines-per-function, @typescript-eslint/no-magic-numbers, functional/no-let, unicorn/import-style, complexity */
import type { PortalQueryOptions, PortalStorage, RunRecord } from './types.js';

type CLIExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

async function execCommand(
  command: string,
  args: string[],
  env?: Record<string, string>,
  cwd?: string,
): Promise<CLIExecResult> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      env: { ...process.env, ...env },
      ...(cwd !== undefined && { cwd }),
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const execError = error as {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    return {
      stdout: execError.stdout ?? '',
      stderr: execError.stderr ?? String(error),
      exitCode: execError.code ?? 1,
    };
  }
}

/**
 * DoltDB storage backend for Code PushUp run results.
 *
 * DoltDB is a MySQL-compatible database with Git-like versioning built in.
 * This provides branch, merge, diff, and time-travel capabilities directly
 * at the data layer — no application-level logic required.
 *
 * Features:
 * - **Branching**: Create data branches for experiments or feature analysis.
 *   E.g., `dolt checkout -b analysis/q1-2026` to analyze Q1 data in isolation.
 * - **Diffs**: Compare run data between branches or commits.
 *   E.g., `dolt diff main..feature/xyz` to see how scores changed.
 * - **Time travel**: Query data at any commit using `AS OF` syntax.
 *   E.g., `SELECT * FROM runs AS OF 'abc123'` to see historical state.
 * - **Merging**: Merge data branches back together with conflict resolution.
 * - **MySQL compatibility**: Use any MySQL client or ORM to query.
 *
 * Architecture:
 *   Code PushUp runs → JSON → Dolt SQL (MySQL wire protocol) → Dolt repo
 *                                                                ├── .dolt/
 *                                                                ├── branches
 *                                                                └── commits
 *
 * Requires: `dolt` CLI installed and in PATH
 * Optional: `doltdb` npm package for programmatic SQL access
 */
export function createDoltDBStorage(
  doltDir: string,
  branch = 'main',
): PortalStorage {
  let initialized = false;

  async function doltCommand(args: string[]): Promise<string> {
    const result = await execCommand(
      'dolt',
      args,
      { DOLT_ROOT_DIR: doltDir },
      doltDir,
    );
    if (result.exitCode !== 0) {
      throw new Error(`dolt ${args[0]} failed: ${result.stderr}`);
    }
    return result.stdout;
  }

  async function doltSQL(sql: string): Promise<Record<string, unknown>[]> {
    const result = await execCommand(
      'dolt',
      ['sql', '-q', sql, '-r', 'json'],
      { DOLT_ROOT_DIR: doltDir },
      doltDir,
    );

    if (result.exitCode !== 0) {
      throw new Error(`dolt sql failed: ${result.stderr}`);
    }

    if (!result.stdout.trim()) {
      return [];
    }

    try {
      const parsed = JSON.parse(result.stdout) as {
        rows?: Record<string, unknown>[];
      };
      return parsed.rows ?? [];
    } catch {
      return [];
    }
  }

  async function initialize(): Promise<void> {
    if (initialized) {
      return;
    }

    const { existsSync } = await import('node:fs');
    const { mkdir } = await import('node:fs/promises');
    const { join } = await import('node:path');

    // Ensure directory exists
    await mkdir(doltDir, { recursive: true });

    // Initialize Dolt repo if not already done
    if (!existsSync(join(doltDir, '.dolt'))) {
      // Set global identity so subsequent commits succeed. (Repo-local
      // config would require the repo to already be initialized, so this
      // has to be global. We use a fixed identity — commits are an
      // internal implementation detail of the portal storage.)
      try {
        await execCommand('dolt', [
          'config',
          '--global',
          '--add',
          'user.email',
          'code-pushup@example.com',
        ]);
      } catch {
        // already set
      }
      try {
        await execCommand('dolt', [
          'config',
          '--global',
          '--add',
          'user.name',
          'Code PushUp',
        ]);
      } catch {
        // already set
      }
      await doltCommand(['init']);
    }

    // Checkout the target branch
    try {
      await doltCommand(['checkout', branch]);
    } catch {
      // Branch doesn't exist, create it
      try {
        await doltCommand(['checkout', '-b', branch]);
      } catch {
        // Already on this branch, that's fine
      }
    }

    // Create table
    await doltSQL(`
      CREATE TABLE IF NOT EXISTS code_pushup_runs (
        id              VARCHAR(255) PRIMARY KEY,
        timestamp       DATETIME NOT NULL,
        commit_sha      VARCHAR(40) NOT NULL,
        branch          VARCHAR(255) NOT NULL,
        pull_request_id INT,
        project         VARCHAR(255),
        mode            VARCHAR(20) NOT NULL,
        duration_ms     INT NOT NULL,
        score           DOUBLE,
        report_json     LONGTEXT NOT NULL,
        diff_json       LONGTEXT,
        new_issues_count INT NOT NULL DEFAULT 0,
        source          VARCHAR(20) NOT NULL DEFAULT 'local',
        organization    VARCHAR(255),
        provider_project VARCHAR(255),
        repository      VARCHAR(255),
        INDEX idx_branch (branch),
        INDEX idx_timestamp (timestamp),
        INDEX idx_commit (commit_sha)
      );
    `);

    // Commit the schema if there are changes
    try {
      await doltCommand(['add', '.']);
      await doltCommand([
        'commit',
        '-m',
        'Initialize code_pushup_runs table',
        '--allow-empty',
      ]);
    } catch {
      // No changes to commit
    }

    initialized = true;
  }

  async function saveRun(record: RunRecord): Promise<void> {
    const escapedReportJson = escapeSQL(record.reportJson);
    const escapedDiffJson = record.diffJson
      ? `'${escapeSQL(record.diffJson)}'`
      : 'NULL';

    await doltSQL(`
      REPLACE INTO code_pushup_runs (
        id, timestamp, commit_sha, branch, pull_request_id,
        project, mode, duration_ms, score, report_json,
        diff_json, new_issues_count, source, organization, provider_project, repository
      ) VALUES (
        '${escapeSQL(record.id)}',
        '${escapeSQL(record.timestamp)}',
        '${escapeSQL(record.commitSha)}',
        '${escapeSQL(record.branch)}',
        ${record.pullRequestId ?? 'NULL'},
        ${record.project ? `'${escapeSQL(record.project)}'` : 'NULL'},
        '${escapeSQL(record.mode)}',
        ${record.durationMs},
        ${record.score ?? 'NULL'},
        '${escapedReportJson}',
        ${escapedDiffJson},
        ${record.newIssuesCount},
        '${escapeSQL(record.source)}',
        ${record.organization ? `'${escapeSQL(record.organization)}'` : 'NULL'},
        ${record.providerProject ? `'${escapeSQL(record.providerProject)}'` : 'NULL'},
        ${record.repository ? `'${escapeSQL(record.repository)}'` : 'NULL'}
      );
    `);

    // Auto-commit each run to Dolt
    await doltCommand(['add', '.']);
    await doltCommand([
      'commit',
      '-m',
      `Add run ${record.id} for ${record.branch}@${record.commitSha.slice(0, 8)}`,
    ]);
  }

  async function queryRuns(options?: PortalQueryOptions): Promise<RunRecord[]> {
    // Handle DoltDB-specific time travel
    let tableRef = 'code_pushup_runs';
    if (options?.doltCommit) {
      tableRef = `code_pushup_runs AS OF '${escapeSQL(options.doltCommit)}'`;
    }

    // Handle branch switching for query
    if (options?.doltBranch && options.doltBranch !== branch) {
      try {
        await doltCommand(['checkout', options.doltBranch]);
      } catch {
        throw new Error(`DoltDB branch '${options.doltBranch}' does not exist`);
      }
    }

    const conditions: string[] = [];

    if (options?.branch) {
      conditions.push(`branch = '${escapeSQL(options.branch)}'`);
    }
    if (options?.project) {
      conditions.push(`project = '${escapeSQL(options.project)}'`);
    }
    if (options?.since) {
      conditions.push(`timestamp >= '${escapeSQL(options.since)}'`);
    }
    if (options?.until) {
      conditions.push(`timestamp <= '${escapeSQL(options.until)}'`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitClause = options?.limit ? `LIMIT ${options.limit}` : '';

    const rows = await doltSQL(
      `SELECT * FROM ${tableRef} ${whereClause}
       ORDER BY timestamp DESC ${limitClause}`,
    );

    // Switch back to original branch if we changed
    if (options?.doltBranch && options.doltBranch !== branch) {
      await doltCommand(['checkout', branch]);
    }

    return rows.map(rowToRunRecord);
  }

  async function getRun(id: string): Promise<RunRecord | null> {
    const rows = await doltSQL(
      `SELECT * FROM code_pushup_runs WHERE id = '${escapeSQL(id)}'`,
    );
    return rows[0] ? rowToRunRecord(rows[0]) : null;
  }

  async function close(): Promise<void> {
    // No persistent connection to close with CLI-based approach
    initialized = false;
  }

  /**
   * Create a new data branch from the current branch.
   */
  async function createBranch(name: string): Promise<void> {
    await doltCommand(['branch', name]);
  }

  /**
   * List all data branches.
   */
  async function listBranches(): Promise<string[]> {
    const output = await doltCommand(['branch', '--list']);
    return output
      .split('\n')
      .map(line => line.replace(/^\*?\s*/, '').trim())
      .filter(Boolean);
  }

  /**
   * Show diff between two branches or commits.
   */
  async function diff(from: string, to: string): Promise<string> {
    return doltCommand(['diff', `${from}..${to}`]);
  }

  /**
   * List commit log.
   */
  async function log(limit = 20): Promise<string> {
    return doltCommand(['log', '-n', String(limit)]);
  }

  return {
    initialize,
    saveRun,
    queryRuns,
    getRun,
    close,
    ...({
      createBranch,
      listBranches,
      diff,
      log,
    } as Record<string, unknown>),
  } as PortalStorage;
}

function escapeSQL(value: string): string {
  return value.replace(/'/g, "''").replace(/\\/g, '\\\\');
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
    source: (row['source'] as RunRecord['source'] | undefined) ?? 'local',
    organization: (row['organization'] as string | undefined) ?? undefined,
    providerProject:
      (row['provider_project'] as string | undefined) ??
      (row['az_project'] as string | undefined) ??
      undefined,
    repository: (row['repository'] as string | undefined) ?? undefined,
  };
}
