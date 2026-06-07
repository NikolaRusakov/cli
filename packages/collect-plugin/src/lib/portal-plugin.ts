import { createRequire } from 'node:module';
import {
  type Audit,
  type AuditOutputs,
  type Group,
  type PluginConfig,
  type PluginContext,
  validate,
} from '@code-pushup/models';
import {
  type PortalPluginOptions,
  portalPluginOptionsSchema,
} from './config.js';
import {
  PORTAL_PLUGIN_ICON,
  PORTAL_PLUGIN_SLUG,
  PORTAL_PLUGIN_TITLE,
} from './constants.js';
import { PORTAL_CONTEXT_KEY, createRunnerFunction } from './runner.js';

/**
 * Code PushUp plugin that persists each report to one or more local
 * databases (DuckDB, Apache Iceberg, DoltDB) for historical analysis.
 *
 * @public
 * @param options - {@link PortalPluginOptions} Plugin options
 * @returns Plugin configuration
 *
 * @example
 * ```ts
 * // code-pushup.config.ts
 * import collectPlugin from '@code-pushup/collect-plugin';
 * export default {
 *   plugins: [
 *     collectPlugin({ backends: ['duckdb', 'iceberg'] }),
 *   ],
 * };
 * ```
 */
export function collectPlugin(options: PortalPluginOptions = {}): PluginConfig {
  validate(portalPluginOptionsSchema, options);

  const audit: Audit = {
    slug: 'persist-runs',
    title: 'Persist run records to configured portal databases',
    description:
      'Writes the just-collected report to the configured local database(s).',
  };

  const groups: Group[] = [];

  const context: PluginContext = {
    [PORTAL_CONTEXT_KEY.backends]: options.backends ?? null,
    [PORTAL_CONTEXT_KEY.duckdbPath]: options.duckdbPath ?? null,
    [PORTAL_CONTEXT_KEY.icebergWarehousePath]:
      options.icebergWarehousePath ?? null,
    [PORTAL_CONTEXT_KEY.doltdbPath]: options.doltdbPath ?? null,
    [PORTAL_CONTEXT_KEY.doltdbBranch]: options.doltdbBranch ?? null,
    [PORTAL_CONTEXT_KEY.source]: options.source ?? null,
    [PORTAL_CONTEXT_KEY.organization]: options.organization ?? null,
    [PORTAL_CONTEXT_KEY.providerProject]: options.providerProject ?? null,
    [PORTAL_CONTEXT_KEY.repository]: options.repository ?? null,
    [PORTAL_CONTEXT_KEY.pullRequestId]: options.pullRequestId ?? null,
    [PORTAL_CONTEXT_KEY.commit]: options.commit ?? null,
    [PORTAL_CONTEXT_KEY.scoreTargets]: options.scoreTargets ?? null,
  };

  const packageJson = createRequire(import.meta.url)(
    '../../package.json',
  ) as typeof import('../../package.json');

  return {
    slug: PORTAL_PLUGIN_SLUG,
    title: PORTAL_PLUGIN_TITLE,
    icon: PORTAL_PLUGIN_ICON,
    description:
      'Persists Code PushUp report results to one or more local databases (DuckDB, Apache Iceberg, DoltDB).',
    docsUrl:
      'https://github.com/code-pushup/cli/tree/main/packages/collect-plugin#readme',
    packageName: packageJson.name,
    version: packageJson.version,
    audits: [audit],
    groups,
    runner: createRunnerFunction(),
    context,
  };
}

export type { PortalPluginOptions } from './config.js';
export type { PortalSaveResult } from './portal.js';
export type {
  RunRecord,
  StorageBackend,
  PortalConfig,
  PortalStorage,
} from './storages/types.js';
export { PORTAL_CONTEXT_KEY } from './runner.js';
export type { AuditOutputs, Group };
