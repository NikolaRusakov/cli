/* eslint-disable vitest/require-top-level-describe, vitest/no-conditional-expect, vitest/no-standalone-expect, vitest/require-hook, vitest/padding-around-test-blocks, vitest/require-to-throw-message, n/no-sync, jest-extended/prefer-to-have-been-called-once, unicorn/prefer-number-properties, unicorn/no-useless-undefined */
import { vol } from 'memfs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunResult } from '@code-pushup/ci';
import type {
  BackendStorage,
  PortalStorage,
} from '@code-pushup/collect-plugin';
import { MEMFS_VOLUME } from '@code-pushup/test-utils';
import { saveRunToPortal } from './portal-compat.js';

function makeStubStorage(ok = true): PortalStorage {
  return {
    initialize: vi.fn(async () => undefined),
    saveRun: vi.fn(async () => {
      if (!ok) throw new Error('simulated failure');
    }),
    queryRuns: vi.fn(async () => []),
    getRun: vi.fn(async () => null),
    close: vi.fn(async () => undefined),
  };
}

function makeResult(reportPath: string, diffPath?: string): RunResult {
  return {
    mode: 'standalone',
    commentId: undefined,
    files: {
      current: { json: reportPath, md: `${reportPath}.md` },
      ...(diffPath && { comparison: { json: diffPath, md: `${diffPath}.md` } }),
    },
    newIssues: [{ message: 'new1' }, { message: 'new2' }],
  };
}

describe('saveRunToPortal', () => {
  let reportPath: string;
  let diffPath: string | undefined;

  beforeEach(() => {
    vol.reset();
    vol.fromJSON(
      {
        'report.json': '{"plugins":[]}',
        'diff.json': '{"diffs:[]}',
      },
      MEMFS_VOLUME,
    );
    reportPath = `${MEMFS_VOLUME}/report.json`;
    diffPath = `${MEMFS_VOLUME}/diff.json`;
  });

  it('returns immediately when there are no storages', async () => {
    await expect(
      saveRunToPortal(
        makeResult(reportPath),
        {
          commitSha: 'sha',
          branch: 'main',
          organization: 'org',
          azProject: 'proj',
          repository: 'repo',
          startTime: 0,
        },
        [],
      ),
    ).resolves.toBeUndefined();
  });

  it('translates azProject to providerProject and sets source=ci', async () => {
    const spy = vi.spyOn(
      await import('@code-pushup/collect-plugin'),
      'saveToPortal',
    );

    const storage = makeStubStorage();
    const storages: BackendStorage[] = [{ backend: 'duckdb', storage }];
    await saveRunToPortal(
      makeResult(reportPath),
      {
        commitSha: 'sha-1',
        branch: 'main',
        pullRequestId: 42,
        organization: 'my-org',
        azProject: 'my-proj',
        repository: 'my-repo',
        startTime: 0,
      },
      storages,
    );

    expect(spy).toHaveBeenCalledTimes(1);
    const [inputs, ctx] = spy.mock.calls[0]!;
    expect(ctx).toMatchObject({
      commitSha: 'sha-1',
      branch: 'main',
      pullRequestId: 42,
      source: 'ci',
      organization: 'my-org',
      providerProject: 'my-proj',
      repository: 'my-repo',
    });
    expect(Array.isArray(inputs)).toBe(true);
    expect((inputs as unknown[])[0]).toMatchObject({
      mode: 'standalone',
      reportPath,
      newIssuesCount: 2,
    });

    expect(storage.saveRun).toHaveBeenCalledTimes(1);
  });

  it('forwards diffPath when comparison is present', async () => {
    const spy = vi.spyOn(
      await import('@code-pushup/collect-plugin'),
      'saveToPortal',
    );

    await saveRunToPortal(
      makeResult(reportPath, diffPath),
      {
        commitSha: 'sha-diff',
        branch: 'main',
        organization: 'org',
        azProject: 'proj',
        repository: 'repo',
        startTime: 0,
      },
      [{ backend: 'duckdb', storage: makeStubStorage() }],
    );

    const [inputs] = spy.mock.calls[0]!;
    expect((inputs as unknown[])[0]).toMatchObject({
      mode: 'standalone',
      reportPath,
      diffPath,
    });
  });

  it('forwards pullRequestId only when present', async () => {
    const spy = vi.spyOn(
      await import('@code-pushup/collect-plugin'),
      'saveToPortal',
    );

    await saveRunToPortal(
      makeResult(reportPath),
      {
        commitSha: 'sha-2',
        branch: 'main',
        organization: 'org',
        azProject: 'proj',
        repository: 'repo',
        startTime: 0,
      },
      [{ backend: 'duckdb', storage: makeStubStorage() }],
    );

    const [, ctx] = spy.mock.calls[0]!;
    expect(ctx).not.toHaveProperty('pullRequestId');
  });

  it('accepts plain PortalStorage[] (legacy overload) by wrapping with a fake backend label', async () => {
    const spy = vi.spyOn(
      await import('@code-pushup/collect-plugin'),
      'saveToPortal',
    );

    const legacyStorage = makeStubStorage();
    await saveRunToPortal(
      makeResult(reportPath),
      {
        commitSha: 'sha-3',
        branch: 'main',
        organization: 'org',
        azProject: 'proj',
        repository: 'repo',
        startTime: 0,
      },
      // The legacy call site passed plain PortalStorage[]. The shim
      // wraps them so the new saveToPortal signature is satisfied.
      [legacyStorage],
    );

    expect(spy).toHaveBeenCalledTimes(1);
    // The first argument to saveToPortal is the storages array.
    const third = spy.mock.calls[0]?.[2] as BackendStorage[];
    expect(Array.isArray(third)).toBe(true);
    expect(third[0]?.backend).toBe('duckdb');
    expect(third[0]?.storage).toBe(legacyStorage);
  });

  it('handles monorepo RunResult by producing one record per project', async () => {
    const projectA = `${MEMFS_VOLUME}/p-a.json`;
    const projectB = `${MEMFS_VOLUME}/p-b.json`;
    vol.fromJSON(
      {
        'p-a.json': '{}',
        'p-b.json': '{}',
      },
      MEMFS_VOLUME,
    );
    const result: RunResult = {
      mode: 'monorepo',
      commentId: 1,
      files: { comparison: { md: 'unused' } },
      projects: [
        {
          name: 'pkg-a',
          files: { current: { json: projectA, md: 'x' } },
          newIssues: [{ message: 'a' }],
        },
        {
          name: 'pkg-b',
          files: { current: { json: projectB, md: 'x' } },
          newIssues: [{ message: 'b' }, { message: 'c' }],
        },
      ],
    };

    const spy = vi.spyOn(
      await import('@code-pushup/collect-plugin'),
      'saveToPortal',
    );

    await saveRunToPortal(
      result,
      {
        commitSha: 'sha-mono',
        branch: 'main',
        organization: 'org',
        azProject: 'proj',
        repository: 'repo',
        startTime: 0,
      },
      [{ backend: 'duckdb', storage: makeStubStorage() }],
    );

    const [inputs] = spy.mock.calls[0]!;
    const arr = inputs as Array<{
      mode: string;
      project: string;
      newIssuesCount: number;
    }>;
    expect(arr).toHaveLength(2);
    expect(arr[0]).toMatchObject({
      mode: 'monorepo',
      project: 'pkg-a',
      newIssuesCount: 1,
    });
    expect(arr[1]).toMatchObject({
      mode: 'monorepo',
      project: 'pkg-b',
      newIssuesCount: 2,
    });
  });
});
