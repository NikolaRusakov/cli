/* eslint-disable @typescript-eslint/consistent-type-assertions, max-lines-per-function, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @nx/enforce-module-boundaries */
import type { RunResult } from '@code-pushup/ci';
import {
  type BackendStorage,
  type PortalConfig,
  type PortalStorage,
  type RunRecord,
  type RunRecordInput,
  closePortalStorages,
  createPortalStorages,
  parsePortalConfigFromEnv,
  saveToPortal,
} from '@code-pushup/collect-plugin';

/**
 * Legacy wrapper around `saveToPortal` that accepts the historical
 * `RunResult` shape from `@code-pushup/ci`.
 *
 * @deprecated Use `saveToPortal` from `@code-pushup/collect-plugin`
 * directly so you can build `RunRecordInput[]` yourself.
 */
export async function saveRunToPortal(
  result: RunResult,
  context: {
    commitSha: string;
    branch: string;
    pullRequestId?: number;
    organization: string;
    azProject: string;
    repository: string;
    startTime: number;
  },
  storages: PortalStorage[] | BackendStorage[],
): Promise<void> {
  if (storages.length === 0) {
    return;
  }

  const inputs = runResultToInputs(result);

  // Normalize storages: callers used to pass plain `PortalStorage[]`,
  // but the new API returns `BackendStorage[]` from `createPortalStorages`.
  // We accept both.
  const backendStorages: BackendStorage[] = storages.map((s, index) => {
    if ('backend' in s) {
      return s as BackendStorage;
    }
    // Backwards-compat: assign a fake backend label by index (callers that
    // need the real label should switch to `createPortalStorages`).
    return {
      backend: 'duckdb' as const,
      storage: s,
      _compatIndex: index,
    } as unknown as BackendStorage;
  });

  await saveToPortal(
    inputs,
    {
      commitSha: context.commitSha,
      branch: context.branch,
      ...(context.pullRequestId !== undefined && {
        pullRequestId: context.pullRequestId,
      }),
      source: 'ci',
      organization: context.organization,
      providerProject: context.azProject,
      repository: context.repository,
      startTime: context.startTime,
    },
    backendStorages,
  );
}

function runResultToInputs(result: RunResult): RunRecordInput[] {
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
    mode: 'monorepo',
    project: proj.name,
    reportPath: proj.files.current.json,
    ...(proj.files.comparison?.json && {
      diffPath: proj.files.comparison.json,
    }),
    newIssuesCount: proj.newIssues?.length ?? 0,
  }));
}

// Re-export commonly used helpers for convenience.
export {
  closePortalStorages,
  createPortalStorages,
  parsePortalConfigFromEnv,
  type PortalConfig,
  type PortalStorage,
  type RunRecord,
  type RunRecordInput,
  type BackendStorage,
};
