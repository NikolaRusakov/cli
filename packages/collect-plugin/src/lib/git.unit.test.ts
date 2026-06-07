import type { SimpleGit } from 'simple-git';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { detectGitContext } from './git.js';

function makeStubGit(opts: {
  sha?: string;
  branch?: string;
  throwOnLog?: boolean;
  throwOnRevparse?: boolean;
}): SimpleGit {
  const stub = {
    log: async () => {
      if (opts.throwOnLog) {
        throw new Error('not a git repo');
      }
      return {
        latest: opts.sha
          ? { hash: opts.sha, message: 'msg', author: 'a', date: 'd' }
          : undefined,
      };
    },
    revparse: async (args: string[]) => {
      if (opts.throwOnRevparse) {
        throw new Error('revparse failed');
      }
      if (args[0] === '--abbrev-ref') {
        return opts.branch ?? 'HEAD';
      }
      return '';
    },
  };
  return stub as unknown as SimpleGit;
}

describe('detectGitContext', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when log throws (not a git repo)', async () => {
    const result = await detectGitContext(makeStubGit({ throwOnLog: true }));
    expect(result).toBeNull();
  });

  it('returns null when there are no commits', async () => {
    const result = await detectGitContext(makeStubGit({}));
    expect(result).toBeNull();
  });

  it('returns sha and branch when both are available', async () => {
    const result = await detectGitContext(
      makeStubGit({ sha: 'abc123', branch: 'main' }),
    );
    expect(result).toEqual({ sha: 'abc123', branch: 'main' });
  });

  it('falls back to "HEAD" when revparse throws', async () => {
    const result = await detectGitContext(
      makeStubGit({ sha: 'abc123', throwOnRevparse: true }),
    );
    expect(result).toEqual({ sha: 'abc123', branch: 'HEAD' });
  });

  it('trims whitespace from the branch name', async () => {
    const stub = makeStubGit({ sha: 'abc123' });
    (stub.revparse as unknown as ReturnType<typeof vi.fn>) = vi
      .fn()
      .mockResolvedValue('  feature/branch  \n');
    const result = await detectGitContext(stub);
    expect(result).toEqual({ sha: 'abc123', branch: 'feature/branch' });
  });
});
