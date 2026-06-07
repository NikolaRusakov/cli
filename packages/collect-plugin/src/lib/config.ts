import { z } from 'zod';
import { filePathSchema } from '@code-pushup/models';
import {
  DEFAULT_DOLTDB_BRANCH,
  DEFAULT_DOLTDB_PATH,
  DEFAULT_DUCKDB_PATH,
  DEFAULT_ICEBERG_PATH,
} from './portal.js';
import type { StorageBackend } from './storages/types.js';

export const storageBackendSchema = z
  .enum(['duckdb', 'iceberg', 'doltdb'])
  .meta({ title: 'StorageBackend' });

/**
 * Options for the portal plugin.
 *
 * When `backends` is omitted, the value falls back to the `CP_PORTAL_BACKENDS`
 * env var (or `['duckdb']` if neither is set). Backend-specific paths
 * likewise fall back to `CP_PORTAL_*` env vars or to the documented defaults.
 */
export const portalPluginOptionsSchema = z
  .object({
    backends: z
      .array(storageBackendSchema)
      .nonempty()
      .optional()
      .meta({ description: 'Storage backends to use' }),
    duckdbPath: filePathSchema
      .optional()
      .meta({ description: 'DuckDB database file path' }),
    icebergWarehousePath: filePathSchema
      .optional()
      .meta({ description: 'Iceberg warehouse directory' }),
    doltdbPath: filePathSchema
      .optional()
      .meta({ description: 'DoltDB repo directory' }),
    doltdbBranch: z
      .string()
      .min(1)
      .optional()
      .meta({ description: 'DoltDB branch for writes' }),
    commit: z
      .object({
        sha: z.string().min(1),
        branch: z.string().min(1),
      })
      .optional()
      .meta({
        description:
          'Override git commit/branch detection (auto-detected by default)',
      }),
    pullRequestId: z
      .number()
      .int()
      .positive()
      .optional()
      .meta({ description: 'Pull request ID' }),
    organization: z
      .string()
      .min(1)
      .optional()
      .meta({ description: 'Provider organization (e.g. Azure DevOps)' }),
    providerProject: z
      .string()
      .min(1)
      .optional()
      .meta({ description: 'Provider project (e.g. Azure DevOps)' }),
    repository: z
      .string()
      .min(1)
      .optional()
      .meta({ description: 'Provider repository (e.g. Azure DevOps)' }),
    source: z
      .enum(['local', 'ci'])
      .default('local')
      .meta({ description: 'Source where the run was triggered' }),
    scoreTargets: z
      .record(z.string(), z.number().min(0).max(1))
      .optional()
      .meta({ description: 'Map of audit slug -> target score (0-1)' }),
  })
  .meta({ title: 'PortalPluginOptions' });

export type PortalPluginOptions = z.input<typeof portalPluginOptionsSchema>;

/**
 * Validated options with defaults resolved.
 */
export type ResolvedPortalPluginOptions = {
  backends: StorageBackend[];
  duckdbPath: string;
  icebergWarehousePath: string;
  doltdbPath: string;
  doltdbBranch: string;
  commit?: { sha: string; branch: string };
  pullRequestId?: number;
  organization?: string;
  providerProject?: string;
  repository?: string;
  source: 'local' | 'ci';
  scoreTargets?: Record<string, number>;
};

/**
 * Merges plugin options with environment variables (env wins only when
 * plugin option is not set, matching the existing CP_PORTAL_* contract).
 */
export function resolvePortalOptions(
  options: PortalPluginOptions,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedPortalPluginOptions {
  const backendsFromEnv = env['CP_PORTAL_BACKENDS']
    ?.split(',')
    .map(s => s.trim())
    .filter(
      (s): s is StorageBackend =>
        s === 'duckdb' || s === 'iceberg' || s === 'doltdb',
    );

  return {
    backends: options.backends ?? backendsFromEnv ?? ['duckdb'],
    duckdbPath:
      options.duckdbPath ?? env['CP_PORTAL_DUCKDB_PATH'] ?? DEFAULT_DUCKDB_PATH,
    icebergWarehousePath:
      options.icebergWarehousePath ??
      env['CP_PORTAL_ICEBERG_PATH'] ??
      DEFAULT_ICEBERG_PATH,
    doltdbPath:
      options.doltdbPath ?? env['CP_PORTAL_DOLTDB_PATH'] ?? DEFAULT_DOLTDB_PATH,
    doltdbBranch:
      options.doltdbBranch ??
      env['CP_PORTAL_DOLTDB_BRANCH'] ??
      DEFAULT_DOLTDB_BRANCH,
    ...(options.commit && { commit: options.commit }),
    ...(options.pullRequestId !== undefined && {
      pullRequestId: options.pullRequestId,
    }),
    ...(options.organization && { organization: options.organization }),
    ...(options.providerProject && {
      providerProject: options.providerProject,
    }),
    ...(options.repository && { repository: options.repository }),
    source: options.source ?? 'local',
    ...(options.scoreTargets && { scoreTargets: options.scoreTargets }),
  };
}
