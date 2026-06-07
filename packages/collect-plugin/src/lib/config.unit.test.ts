import { describe, expect, it } from 'vitest';
import { resolvePortalOptions } from './config.js';

describe('resolvePortalOptions', () => {
  it('falls back to defaults when nothing is provided', () => {
    const resolved = resolvePortalOptions({}, {});
    expect(resolved.backends).toEqual(['duckdb']);
    expect(resolved.duckdbPath).toBe('.code-pushup/portal.duckdb');
    expect(resolved.icebergWarehousePath).toBe(
      '.code-pushup/iceberg-warehouse',
    );
    expect(resolved.doltdbPath).toBe('.code-pushup/doltdb');
    expect(resolved.doltdbBranch).toBe('main');
    expect(resolved.source).toBe('local');
  });

  it('prefers explicit plugin options over env', () => {
    const resolved = resolvePortalOptions(
      {
        backends: ['iceberg', 'doltdb'],
        duckdbPath: '/tmp/explicit.db',
      },
      {
        CP_PORTAL_BACKENDS: 'duckdb',
        CP_PORTAL_DUCKDB_PATH: '/tmp/env.db',
      },
    );
    expect(resolved.backends).toEqual(['iceberg', 'doltdb']);
    expect(resolved.duckdbPath).toBe('/tmp/explicit.db');
  });

  it('falls back to env when plugin options are absent', () => {
    const resolved = resolvePortalOptions(
      {},
      {
        CP_PORTAL_BACKENDS: 'duckdb,doltdb',
        CP_PORTAL_DUCKDB_PATH: '/tmp/env.db',
        CP_PORTAL_DOLTDB_BRANCH: 'feature',
      },
    );
    expect(resolved.backends).toEqual(['duckdb', 'doltdb']);
    expect(resolved.duckdbPath).toBe('/tmp/env.db');
    expect(resolved.doltdbBranch).toBe('feature');
  });

  it('drops invalid backends from the env value', () => {
    const resolved = resolvePortalOptions(
      {},
      { CP_PORTAL_BACKENDS: 'duckdb,postgres,iceberg' },
    );
    expect(resolved.backends).toEqual(['duckdb', 'iceberg']);
  });

  it('passes through provider context fields when supplied', () => {
    const resolved = resolvePortalOptions({
      commit: { sha: 'abc123', branch: 'main' },
      pullRequestId: 42,
      organization: 'my-org',
      providerProject: 'my-project',
      repository: 'my-repo',
      source: 'ci',
      scoreTargets: { 'speed-index': 0.9 },
    });
    expect(resolved.commit).toEqual({ sha: 'abc123', branch: 'main' });
    expect(resolved.pullRequestId).toBe(42);
    expect(resolved.organization).toBe('my-org');
    expect(resolved.providerProject).toBe('my-project');
    expect(resolved.repository).toBe('my-repo');
    expect(resolved.source).toBe('ci');
    expect(resolved.scoreTargets).toEqual({ 'speed-index': 0.9 });
  });
});
