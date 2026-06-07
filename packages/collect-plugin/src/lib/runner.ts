/* eslint-disable @typescript-eslint/array-type, n/no-sync, max-lines-per-function, sonarjs/no-duplicate-string, @typescript-eslint/no-import-type-side-effects */
import ansis from 'ansis';
import { existsSync, readFileSync } from 'node:fs';
import {
  type AuditOutput,
  type AuditOutputs,
  type Report,
  type RunnerArgs,
  type RunnerFunction,
  type Table,
} from '@code-pushup/models';
import { createReportPath, logger } from '@code-pushup/utils';
import { resolvePortalOptions } from './config.js';
import { readContextOptions } from './context.js';
import { detectGitContext } from './git.js';
import {
  closePortalStorages,
  createPortalStorages,
  saveToPortal,
} from './portal.js';
import type { RunRecordInput } from './record.js';

export { PORTAL_CONTEXT_KEY } from './runner-keys.js';

/**
 * Creates the `RunnerFunction` for the portal plugin.
 *
 * The runner:
 * 1. Resolves the just-written `report.json` and (if present) `report-diff.json`
 *    from the persist output directory.
 * 2. Reads the user options from `RunnerArgs.pluginContext` and merges with env vars.
 * 3. Detects git commit/branch if not provided.
 * 4. Persists one or more `RunRecord`s to every configured backend.
 * 5. Returns audit outputs describing what happened.
 */
export function createRunnerFunction(): RunnerFunction {
  return async function runner(args: RunnerArgs): Promise<AuditOutputs> {
    const contextOptions = readContextOptions(args.pluginContext);
    const resolved = resolvePortalOptions(contextOptions);

    const startTime = Date.now();
    const commit = resolved.commit ?? (await detectGitContext());

    if (!commit) {
      logger.warn(
        '[portal] No git commit detected; skipping portal persistence. ' +
          'Pass `commit: { sha, branch }` in plugin options to override.',
      );
      return [
        makeAuditOutput('persist-runs', 0, {
          message: 'No git commit detected',
        }),
      ];
    }

    const inputs = buildRunRecordInputs(args);
    if (inputs.length === 0) {
      logger.warn(
        `[portal] No report.json found in ${ansis.cyan(
          args.persist.outputDir,
        )}; skipping portal persistence.`,
      );
      return [
        makeAuditOutput('persist-runs', 0, {
          message: `No report.json in ${args.persist.outputDir}`,
        }),
      ];
    }

    const runContext = {
      commitSha: commit.sha,
      branch: commit.branch,
      ...(resolved.pullRequestId !== undefined && {
        pullRequestId: resolved.pullRequestId,
      }),
      source: resolved.source,
      ...(resolved.organization && { organization: resolved.organization }),
      ...(resolved.providerProject && {
        providerProject: resolved.providerProject,
      }),
      ...(resolved.repository && { repository: resolved.repository }),
      startTime,
    };

    const storages = createPortalStorages({
      backends: resolved.backends,
      duckdbPath: resolved.duckdbPath,
      icebergWarehousePath: resolved.icebergWarehousePath,
      doltdbPath: resolved.doltdbPath,
      doltdbBranch: resolved.doltdbBranch,
    });

    try {
      const results = await saveToPortal(inputs, runContext, storages);
      return [
        makeAuditOutput('persist-runs', 1, {
          message: formatSaveResults(results),
        }),
      ];
    } finally {
      await closePortalStorages(storages);
    }
  };
}

/**
 * Builds the inputs to the record builder from the persist output directory.
 *
 * Looks for:
 * - `<outputDir>/report.json` (always required)
 * - `<outputDir>/report-diff.json` (if present, attached to the record)
 */
function buildRunRecordInputs(args: RunnerArgs): RunRecordInput[] {
  const { outputDir, filename } = args.persist;
  const reportPath = createReportPath({
    outputDir,
    filename,
    format: 'json',
  });
  const diffPath = createReportPath({
    outputDir,
    filename,
    format: 'json',
    suffix: 'diff',
  });

  if (!existsSync(reportPath)) {
    return [];
  }

  const reportJson = safeReadFileSync(reportPath);
  const newIssuesCount = countNewIssues(safeParseReport(reportJson));
  const diffJson = existsSync(diffPath)
    ? safeReadFileSync(diffPath)
    : undefined;

  return [
    {
      mode: 'standalone',
      reportJson,
      ...(diffJson !== undefined && { diffJson }),
      newIssuesCount,
    },
  ];
}

function safeReadFileSync(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return '{}';
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

type SaveResultLike = { backend: string; ok: boolean; error?: string };

function formatSaveResults(results: SaveResultLike[]): string {
  if (results.length === 0) {
    return 'No backends configured';
  }
  return results
    .map(r =>
      r.ok ? `${r.backend} ✓` : `${r.backend} ✗ ${r.error ?? 'failed'}`,
    )
    .join(', ');
}

function makeAuditOutput(
  slug: string,
  score: number,
  opts: { message: string },
): AuditOutput {
  const table: Table = {
    columns: [
      { key: 'metric', label: 'Metric', align: 'left' },
      { key: 'value', label: 'Value', align: 'left' },
    ],
    rows: [{ metric: 'status', value: opts.message }],
  };
  return {
    slug,
    score,
    value: score,
    displayValue: opts.message,
    details: { issues: [], table },
  };
}

// Used to confirm that `Report` is imported in the public type surface.
export type _Report = Report;
