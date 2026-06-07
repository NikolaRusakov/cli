import { randomUUID } from 'node:crypto';

/* eslint-disable n/no-sync, @typescript-eslint/array-type */
import { readFileSync } from 'node:fs';
import type { RunRecord, RunSource } from './storages/types.js';

/**
 * Inputs describing one or more run records to be persisted.
 *
 * The portal plugin supports both standalone runs (single project) and
 * monorepo runs (one record per project). Each entry corresponds to one
 * persisted `RunRecord`.
 */
export type RunRecordInput = {
  /** Project name (monorepo only). Omit for standalone. */
  project?: string;
  /** Run mode. Defaults to 'standalone' when no project is set. */
  mode?: 'standalone' | 'monorepo';
  /** JSON-serialized report. If not provided, `reportPath` is read. */
  reportJson?: string;
  /** Path to a JSON report file on disk. */
  reportPath?: string;
  /** JSON-serialized diff. If not provided, `diffPath` is read. */
  diffJson?: string;
  /** Path to a JSON diff file on disk. */
  diffPath?: string;
  /** New issues introduced in this run. */
  newIssuesCount?: number;
  /** Overall score (0-1), if known. */
  score?: number;
};

/**
 * Common context for all records produced from a single run.
 */
export type RunContext = {
  /** Git commit SHA. */
  commitSha: string;
  /** Branch name. */
  branch: string;
  /** Pull request ID, if applicable. */
  pullRequestId?: number;
  /** Where the run was triggered. */
  source: RunSource;
  /** Optional provider identifier (e.g. Azure DevOps organization). */
  organization?: string;
  /** Optional provider project (e.g. Azure DevOps project). */
  providerProject?: string;
  /** Optional provider repository (e.g. Azure DevOps repository ID). */
  repository?: string;
  /** When the run started (ms epoch). Used to compute `durationMs`. */
  startTime: number;
};

/**
 * Builds `RunRecord[]` from a list of inputs and shared context.
 *
 * Files are read lazily and silently fall back to `'{}'` on error so that a
 * missing artifact does not break the entire persistence step.
 *
 * If the caller does not pass `newIssuesCount`, this function derives it
 * from the report JSON (count of `issues` arrays on each audit).
 */
export function buildRunRecords(
  inputs: RunRecordInput[],
  context: RunContext,
): RunRecord[] {
  const timestamp = new Date().toISOString();
  const durationMs = Date.now() - context.startTime;
  const id = randomUUID();

  return inputs.map(input => {
    const reportJson = input.reportJson ?? readReport(input.reportPath) ?? '{}';
    const diffJson = input.diffJson ?? readReport(input.diffPath);
    return {
      id,
      timestamp,
      commitSha: context.commitSha,
      branch: context.branch,
      pullRequestId: context.pullRequestId,
      mode: input.mode ?? (input.project ? 'monorepo' : 'standalone'),
      project: input.project,
      durationMs,
      score: input.score,
      reportJson,
      ...(diffJson !== undefined && { diffJson }),
      newIssuesCount:
        input.newIssuesCount ?? countNewIssues(safeParseReport(reportJson)),
      source: context.source,
      organization: context.organization,
      providerProject: context.providerProject,
      repository: context.repository,
    };
  });
}

function readReport(filePath: string | undefined): string | undefined {
  if (!filePath) {
    return undefined;
  }
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

type PartialReport = {
  plugins?: Array<{ audits?: Array<{ issues?: unknown[] }> }>;
};

function safeParseReport(json: string): PartialReport | null {
  try {
    return JSON.parse(json) as PartialReport;
  } catch {
    return null;
  }
}

function countNewIssues(report: PartialReport | null): number {
  if (!report?.plugins) {
    return 0;
  }
  return report.plugins.reduce(
    (sum, plugin) =>
      sum +
      (plugin.audits?.reduce(
        (acc, audit) => acc + (audit.issues?.length ?? 0),
        0,
      ) ?? 0),
    0,
  );
}
