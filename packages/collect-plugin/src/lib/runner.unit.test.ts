/* eslint-disable vitest/require-top-level-describe, vitest/require-to-throw-message, unicorn/no-useless-undefined */
import fc from 'fast-check';
import { vol } from 'memfs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AuditOutput,
  DEFAULT_PERSIST_CONFIG,
  type RunnerArgs,
} from '@code-pushup/models';
import { MEMFS_VOLUME } from '@code-pushup/test-utils';
import { PORTAL_CONTEXT_KEY, collectPlugin } from '../index.js';
import { portalPluginOptionsSchema } from './config.js';
import { readContextOptions } from './context.js';

const FIXTURE_REPORT = {
  commit: {
    hash: 'abcdef',
    message: 'msg',
    author: 'tester',
    date: '2026-06-01',
  },
  packageName: 'demo',
  version: '1.0.0',
  date: '2026-06-01',
  duration: 1,
  plugins: [
    {
      slug: 'eslint',
      title: 'ESLint',
      audits: [{ slug: 'no-debugger', title: 'no-debugger', issues: [{}] }],
    },
  ],
};

beforeEach(() => {
  vol.reset();
  vol.fromJSON({ 'report.json': JSON.stringify(FIXTURE_REPORT) }, MEMFS_VOLUME);
});

describe('collectPlugin', () => {
  it('returns a PluginConfig with the expected meta', () => {
    const cfg = collectPlugin({ backends: ['duckdb'] });
    expect(cfg.slug).toBe('portal');
    expect(cfg.title).toBe('Portal');
    expect(cfg.audits).toHaveLength(1);
    expect(cfg.audits[0]?.slug).toBe('persist-runs');
    expect(cfg.context).toEqual(
      expect.objectContaining({
        [PORTAL_CONTEXT_KEY.backends]: ['duckdb'],
      }),
    );
  });

  it('validates options via the zod schema', () => {
    expect(() => collectPlugin({ backends: ['nope' as 'duckdb'] })).toThrow();
  });
});

describe('createRunnerFunction', () => {
  function makeArgs(overrides: Partial<RunnerArgs> = {}): RunnerArgs {
    return {
      ...DEFAULT_PERSIST_CONFIG,
      persist: {
        ...DEFAULT_PERSIST_CONFIG,
        outputDir: MEMFS_VOLUME,
        filename: 'report',
      },
      pluginContext: {
        [PORTAL_CONTEXT_KEY.backends]: ['duckdb'],
        [PORTAL_CONTEXT_KEY.duckdbPath]: `${MEMFS_VOLUME}/portal.duckdb`,
        [PORTAL_CONTEXT_KEY.commit]: { sha: 'sha-abc', branch: 'main' },
        [PORTAL_CONTEXT_KEY.source]: 'local',
      },
      ...overrides,
    };
  }

  it('returns a successful audit when storage is configured', async () => {
    const { createRunnerFunction } = await import('./runner.js');
    const runner = createRunnerFunction();
    const out = await runner(makeArgs());
    expect(out).toHaveLength(1);
    const audit = out[0] as AuditOutput;
    expect(audit.slug).toBe('persist-runs');
    expect(audit.score).toBe(1);
    expect(audit.displayValue).toContain('duckdb');
  });

  it('returns a failure audit with score 0 when no commit is available', async () => {
    vi.doMock('./git.js', () => ({
      detectGitContext: () => Promise.resolve(null),
    }));
    vi.resetModules();
    const { createRunnerFunction: createRunner } = await import('./runner.js');
    const args: RunnerArgs = makeArgs({
      pluginContext: {
        [PORTAL_CONTEXT_KEY.backends]: ['duckdb'],
        [PORTAL_CONTEXT_KEY.duckdbPath]: `${MEMFS_VOLUME}/portal.duckdb`,
      },
    });
    const runner = createRunner();
    const out = await runner(args);
    expect(out[0]?.score).toBe(0);
    expect(out[0]?.displayValue).toContain('commit');
    vi.doUnmock('./git.js');
  });

  it('returns a failure audit when no report file is present', async () => {
    vol.reset();
    const { createRunnerFunction } = await import('./runner.js');
    const args: RunnerArgs = makeArgs({
      pluginContext: {
        [PORTAL_CONTEXT_KEY.backends]: ['duckdb'],
        [PORTAL_CONTEXT_KEY.duckdbPath]: `${MEMFS_VOLUME}/portal.duckdb`,
        [PORTAL_CONTEXT_KEY.commit]: { sha: 'sha', branch: 'main' },
      },
    });
    const runner = createRunnerFunction();
    const out = await runner(args);
    expect(out[0]?.score).toBe(0);
    expect(out[0]?.displayValue).toContain('No report.json');
  });

  it('returns score 1 and persists a "{}" report when report.json is malformed', async () => {
    vol.reset();
    vol.fromJSON({ 'report.json': 'this is not JSON {{{' }, MEMFS_VOLUME);
    const { createRunnerFunction } = await import('./runner.js');
    const args: RunnerArgs = makeArgs({
      pluginContext: {
        [PORTAL_CONTEXT_KEY.backends]: ['duckdb'],
        [PORTAL_CONTEXT_KEY.duckdbPath]: `${MEMFS_VOLUME}/portal.duckdb`,
        [PORTAL_CONTEXT_KEY.commit]: { sha: 'sha', branch: 'main' },
      },
    });
    const runner = createRunnerFunction();
    const out = await runner(args);
    expect(out[0]?.score).toBe(1);
    expect(out[0]?.displayValue).toContain('duckdb');
  });

  it('falls back to env defaults when pluginContext is empty', async () => {
    vol.reset();
    const { createRunnerFunction } = await import('./runner.js');
    const args: RunnerArgs = makeArgs({
      pluginContext: {},
    });
    const runner = createRunnerFunction();
    const out = await runner(args);
    // No commit detected, no plugin context → score 0 with "commit" message
    expect(out[0]?.score).toBe(0);
    expect(out[0]?.displayValue).toContain('commit');
  });

  it('falls back to default backends when pluginContext.backends has the wrong type', async () => {
    const { createRunnerFunction } = await import('./runner.js');
    const args: RunnerArgs = makeArgs({
      pluginContext: {
        [PORTAL_CONTEXT_KEY.backends]: 'duckdb' as unknown as string[],
        [PORTAL_CONTEXT_KEY.duckdbPath]: `${MEMFS_VOLUME}/portal.duckdb`,
        [PORTAL_CONTEXT_KEY.commit]: { sha: 'sha', branch: 'main' },
      },
    });
    const runner = createRunnerFunction();
    const out = await runner(args);
    // Defaulted to ['duckdb'] (string was rejected); should still succeed
    expect(out[0]?.score).toBe(1);
    expect(out[0]?.displayValue).toContain('duckdb');
  });

  it('ignores pluginContext.commit when it is missing one of sha/branch', async () => {
    const { createRunnerFunction } = await import('./runner.js');
    const args: RunnerArgs = makeArgs({
      pluginContext: {
        [PORTAL_CONTEXT_KEY.backends]: ['duckdb'],
        [PORTAL_CONTEXT_KEY.duckdbPath]: `${MEMFS_VOLUME}/portal.duckdb`,
        [PORTAL_CONTEXT_KEY.commit]: { sha: 'only-sha' },
      },
    });
    const runner = createRunnerFunction();
    const out = await runner(args);
    // No full commit override; falls through to detectGitContext
    expect(out[0]?.score).toBe(0);
    expect(out[0]?.displayValue).toContain('commit');
  });

  it('ignores extra fields in pluginContext.commit', async () => {
    const { createRunnerFunction } = await import('./runner.js');
    const args: RunnerArgs = makeArgs({
      pluginContext: {
        [PORTAL_CONTEXT_KEY.backends]: ['duckdb'],
        [PORTAL_CONTEXT_KEY.duckdbPath]: `${MEMFS_VOLUME}/portal.duckdb`,
        [PORTAL_CONTEXT_KEY.commit]: {
          sha: 'sha-extra',
          branch: 'main',
          extra: 'ignored',
          another: 42,
        },
      },
    });
    const runner = createRunnerFunction();
    const out = await runner(args);
    expect(out[0]?.score).toBe(1);
  });

  it('lists all configured backends in the display value when multiple are enabled', async () => {
    vi.doMock('./portal.js', async () => {
      const actual =
        await vi.importActual<typeof import('./portal.js')>('./portal.js');
      return {
        ...actual,
        createPortalStorages: () => [
          { backend: 'duckdb', storage: makeStubStorage(true) },
          { backend: 'iceberg', storage: makeStubStorage(true) },
          {
            backend: 'doltdb',
            storage: makeStubStorage(false, 'simulated failure'),
          },
        ],
        closePortalStorages: async () => undefined,
      };
    });
    vi.resetModules();
    const { createRunnerFunction: createRunner } = await import('./runner.js');
    const args: RunnerArgs = makeArgs({
      pluginContext: {
        [PORTAL_CONTEXT_KEY.backends]: ['duckdb', 'iceberg', 'doltdb'],
        [PORTAL_CONTEXT_KEY.duckdbPath]: `${MEMFS_VOLUME}/x.db`,
        [PORTAL_CONTEXT_KEY.commit]: { sha: 'multi', branch: 'main' },
      },
    });
    const runner = createRunner();
    const out = await runner(args);
    const display = out[0]?.displayValue ?? '';
    expect(display).toContain('duckdb');
    expect(display).toContain('iceberg');
    expect(display).toContain('doltdb');
    expect(display).toContain('simulated failure');
    vi.doUnmock('./portal.js');
  });
});

function makeStubStorage(ok: boolean, error?: string) {
  return {
    initialize: async () => undefined,
    saveRun: async () => {
      if (!ok) {
        throw new Error(error ?? 'simulated failure');
      }
    },
    queryRuns: async () => [],
    getRun: async () => null,
    close: async () => undefined,
  };
}

describe('readContextOptions (property-based)', () => {
  // Arbitrary value: any JSON-serializable value, including primitives and
  // nested objects/arrays.
  const arbitraryValue = fc.oneof(
    fc.string(),
    fc.integer(),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.boolean(),
    fc.constant(null),
    fc.array(fc.string(), { maxLength: 5 }),
    fc.dictionary(
      fc.string(),
      fc.oneof(fc.string(), fc.integer(), fc.boolean()),
      {
        maxKeys: 5,
      },
    ),
  );

  it('never throws and always returns a value accepted by the zod schema', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), arbitraryValue, { maxKeys: 30 }),
        ctx => {
          const out = readContextOptions(ctx);
          expect(() => portalPluginOptionsSchema.parse(out)).not.toThrow();
        },
      ),
      { numRuns: 50 },
    );
  });

  it('returns an empty object for undefined input', () => {
    expect(readContextOptions(undefined)).toEqual({});
  });

  it('returns an empty object for an empty object input', () => {
    expect(readContextOptions({})).toEqual({});
  });
});
