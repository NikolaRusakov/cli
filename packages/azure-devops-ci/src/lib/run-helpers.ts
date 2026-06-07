import type { RunResult } from '@code-pushup/ci';
import type { RunRecordInput } from '@code-pushup/collect-plugin';

/**
 * Translates a `RunResult` (returned by `runInCI`) into the
 * `RunRecordInput[]` shape that `saveToPortal` consumes.
 *
 * Extracted from `run.ts` so it can be unit- and integration-tested without
 * standing up the full Azure DevOps pipeline.
 */
export function buildInputsFromRunResult(result: RunResult): RunRecordInput[] {
  if (result.mode === 'standalone') {
    return [
      {
        mode: 'standalone',
        reportPath: result.files.current.json,
        ...(result.files.comparison?.json && {
          diffPath: result.files.comparison.json,
        }),
        newIssuesCount: result.newIssues?.length ?? 0,
      },
    ];
  }

  return result.projects.map(proj => ({
    mode: 'monorepo' as const,
    project: proj.name,
    reportPath: proj.files.current.json,
    ...(proj.files.comparison?.json && {
      diffPath: proj.files.comparison.json,
    }),
    newIssuesCount: proj.newIssues?.length ?? 0,
  }));
}
