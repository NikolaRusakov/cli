/**
 * Keys used in `PluginConfig.context` and `RunnerArgs.pluginContext` to
 * round-trip user options through the runner.
 *
 * Defined in a separate file (no dependencies on `runner.ts`) so that both
 * the runner and the standalone `context.ts` helpers can import it without
 * creating a circular import.
 */
export const PORTAL_CONTEXT_KEY = {
  backends: 'backends',
  duckdbPath: 'duckdbPath',
  icebergWarehousePath: 'icebergWarehousePath',
  doltdbPath: 'doltdbPath',
  doltdbBranch: 'doltdbBranch',
  source: 'source',
  organization: 'organization',
  providerProject: 'providerProject',
  repository: 'repository',
  pullRequestId: 'pullRequestId',
  scoreTargets: 'scoreTargets',
  commit: 'commit',
} as const;
