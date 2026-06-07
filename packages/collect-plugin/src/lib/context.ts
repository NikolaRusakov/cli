/* eslint-disable functional/immutable-data, no-param-reassign */
import type { PluginContext } from '@code-pushup/models';
import type { PortalPluginOptions } from './config.js';
import { PORTAL_CONTEXT_KEY } from './runner-keys.js';

/**
 * Type-narrows an unknown context value to a string.
 */
export function toString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Type-narrows an unknown context value to a finite number. Accepts both
 * numbers and numeric strings (e.g. `"42"`).
 */
export function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Type-narrows an unknown context value to `'local' | 'ci'`.
 */
export function toSource(value: unknown): 'local' | 'ci' | undefined {
  return value === 'local' || value === 'ci' ? value : undefined;
}

/**
 * Type-narrows an unknown context value to a non-empty
 * `Record<string, number>`. Returns `undefined` if the value is not an
 * object or contains no finite numbers.
 */
export function toScoreTargetsRecord(
  value: unknown,
): Record<string, number> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, number] =>
      typeof entry[1] === 'number' && Number.isFinite(entry[1]),
  );
  const out = Object.fromEntries(entries) as Record<string, number>;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Type-narrows an unknown context value to a `{ sha, branch }` object.
 */
export function toCommit(
  value: unknown,
): { sha: string; branch: string } | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const v = value as { sha?: unknown; branch?: unknown };
  if (typeof v.sha === 'string' && typeof v.branch === 'string') {
    return { sha: v.sha, branch: v.branch };
  }
  return undefined;
}

/**
 * Type-narrows an unknown context value to a list of valid backend names.
 * Invalid entries are dropped; an empty result is `undefined`.
 */
export function toBackends(
  value: unknown,
): ('duckdb' | 'iceberg' | 'doltdb')[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const allowed = new Set(['duckdb', 'iceberg', 'doltdb']);
  const filtered = value.filter(
    (v): v is 'duckdb' | 'iceberg' | 'doltdb' =>
      typeof v === 'string' && allowed.has(v),
  );
  return filtered.length > 0 ? filtered : undefined;
}

function assignOptional<T>(
  result: PortalPluginOptions,
  key: keyof PortalPluginOptions,
  value: T | undefined,
): void {
  if (value !== undefined) {
    (result as Record<string, unknown>)[key] = value;
  }
}

function readStringField(
  result: PortalPluginOptions,
  key: keyof PortalPluginOptions,
  value: unknown,
): void {
  assignOptional(result, key, toString(value));
}

function readScoreTargetsField(
  result: PortalPluginOptions,
  value: unknown,
): void {
  const targets = toScoreTargetsRecord(value);
  if (targets) {
    result.scoreTargets = targets;
  }
}

function readCommitField(result: PortalPluginOptions, value: unknown): void {
  const commit = toCommit(value);
  if (commit) {
    result.commit = commit;
  }
}

function readBackendsField(result: PortalPluginOptions, value: unknown): void {
  const backends = toBackends(value);
  if (backends) {
    result.backends = backends;
  }
}

/**
 * Maps a `PluginContext` (the `context` field of `PluginConfig`, round-tripped
 * through `RunnerArgs.pluginContext`) back to a `PortalPluginOptions` object.
 *
 * Every value is type-narrowed; unknown / malformed values are silently
 * dropped. The returned object is guaranteed to be accepted by
 * `portalPluginOptionsSchema.parse(...)` (verified by a property-based test).
 */
export function readContextOptions(
  context: PluginContext | undefined,
): PortalPluginOptions {
  if (!context) {
    return {};
  }

  const result: PortalPluginOptions = {};
  const get = (key: string): unknown => context[key];

  readBackendsField(result, get(PORTAL_CONTEXT_KEY.backends));
  readStringField(result, 'duckdbPath', get(PORTAL_CONTEXT_KEY.duckdbPath));
  readStringField(
    result,
    'icebergWarehousePath',
    get(PORTAL_CONTEXT_KEY.icebergWarehousePath),
  );
  readStringField(result, 'doltdbPath', get(PORTAL_CONTEXT_KEY.doltdbPath));
  readStringField(result, 'doltdbBranch', get(PORTAL_CONTEXT_KEY.doltdbBranch));

  const source = toSource(get(PORTAL_CONTEXT_KEY.source));
  if (source) {
    result.source = source;
  }

  readStringField(result, 'organization', get(PORTAL_CONTEXT_KEY.organization));
  readStringField(
    result,
    'providerProject',
    get(PORTAL_CONTEXT_KEY.providerProject),
  );
  readStringField(result, 'repository', get(PORTAL_CONTEXT_KEY.repository));

  const pullRequestId = toNumber(get(PORTAL_CONTEXT_KEY.pullRequestId));
  if (pullRequestId !== undefined) {
    result.pullRequestId = pullRequestId;
  }

  readCommitField(result, get(PORTAL_CONTEXT_KEY.commit));
  readScoreTargetsField(result, get(PORTAL_CONTEXT_KEY.scoreTargets));

  return result;
}
