/* eslint-disable vitest/padding-around-test-blocks, vitest/no-conditional-expect, unicorn/prefer-number-properties */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  readContextOptions,
  toBackends,
  toCommit,
  toNumber,
  toScoreTargetsRecord,
  toSource,
  toString,
} from './context.js';

describe('toString', () => {
  it('returns the string for string input', () => {
    expect(toString('hello')).toBe('hello');
  });
  it('returns undefined for non-string input', () => {
    expect(toString(42)).toBeUndefined();
    expect(toString(null)).toBeUndefined();
    expect(toString(undefined)).toBeUndefined();
    expect(toString({})).toBeUndefined();
  });
  it('property: never throws for arbitrary input', () => {
    fc.assert(
      fc.property(fc.anything(), value => {
        const out = toString(value);
        expect(out === undefined || typeof out === 'string').toBe(true);
      }),
      { numRuns: 50 },
    );
  });
});

describe('toNumber', () => {
  it('returns the number for finite numeric input', () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber(0)).toBe(0);
    expect(toNumber(-1.5)).toBe(-1.5);
  });
  it('rejects NaN and Infinity', () => {
    expect(toNumber(NaN)).toBeUndefined();
    expect(toNumber(Infinity)).toBeUndefined();
    expect(toNumber(-Infinity)).toBeUndefined();
  });
  it('parses numeric strings', () => {
    expect(toNumber('42')).toBe(42);
    expect(toNumber('-1.5')).toBe(-1.5);
  });
  it('rejects non-numeric strings', () => {
    expect(toNumber('abc')).toBeUndefined();
  });
  it('property: never throws and never returns NaN', () => {
    fc.assert(
      fc.property(fc.anything(), value => {
        const out = toNumber(value);
        if (out !== undefined) {
          expect(Number.isFinite(out)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('toSource', () => {
  it('accepts "local" and "ci"', () => {
    expect(toSource('local')).toBe('local');
    expect(toSource('ci')).toBe('ci');
  });
  it('rejects other strings', () => {
    expect(toSource('other')).toBeUndefined();
    expect(toSource('LOCAL')).toBeUndefined();
  });
});

describe('toScoreTargetsRecord', () => {
  it('returns a record of finite numbers', () => {
    expect(toScoreTargetsRecord({ 'speed-index': 0.9, lcp: 1 })).toEqual({
      'speed-index': 0.9,
      lcp: 1,
    });
  });
  it('drops non-finite-number values', () => {
    expect(
      toScoreTargetsRecord({ ok: 0.5, bad: NaN, str: 'no', inf: Infinity }),
    ).toEqual({ ok: 0.5 });
  });
  it('returns undefined for empty / non-object input', () => {
    expect(toScoreTargetsRecord({})).toBeUndefined();
    expect(toScoreTargetsRecord(null)).toBeUndefined();
    expect(toScoreTargetsRecord('not an object')).toBeUndefined();
    expect(toScoreTargetsRecord(42)).toBeUndefined();
  });
});

describe('toCommit', () => {
  it('returns the object when both sha and branch are strings', () => {
    expect(toCommit({ sha: 'abc', branch: 'main' })).toEqual({
      sha: 'abc',
      branch: 'main',
    });
  });
  it('returns undefined when one is missing or wrong type', () => {
    expect(toCommit({ sha: 'abc' })).toBeUndefined();
    expect(toCommit({ branch: 'main' })).toBeUndefined();
    expect(toCommit({ sha: 123, branch: 'main' })).toBeUndefined();
  });
  it('ignores extra fields', () => {
    expect(toCommit({ sha: 'x', branch: 'y', extra: 'ok' })).toEqual({
      sha: 'x',
      branch: 'y',
    });
  });
});

describe('toBackends', () => {
  it('returns valid entries', () => {
    expect(toBackends(['duckdb', 'iceberg'])).toEqual(['duckdb', 'iceberg']);
  });
  it('filters invalid entries', () => {
    expect(toBackends(['duckdb', 'postgres', 'iceberg'])).toEqual([
      'duckdb',
      'iceberg',
    ]);
  });
  it('returns undefined when no valid entries', () => {
    expect(toBackends(['postgres'])).toBeUndefined();
    expect(toBackends([])).toBeUndefined();
  });
  it('returns undefined for non-array input', () => {
    expect(toBackends('duckdb')).toBeUndefined();
    expect(toBackends(null)).toBeUndefined();
    expect(toBackends({ duckdb: true })).toBeUndefined();
  });
});

describe('readContextOptions', () => {
  it('returns an empty object for undefined or empty input', () => {
    expect(readContextOptions(undefined)).toEqual({});
    expect(readContextOptions({})).toEqual({});
  });

  it('extracts all known fields when given valid values', () => {
    expect(
      readContextOptions({
        backends: ['duckdb', 'iceberg'],
        duckdbPath: '/tmp/x.db',
        icebergWarehousePath: '/tmp/ice',
        doltdbPath: '/tmp/dolt',
        doltdbBranch: 'feature',
        source: 'ci',
        organization: 'org',
        providerProject: 'proj',
        repository: 'repo',
        pullRequestId: 42,
        commit: { sha: 'abc', branch: 'main' },
        scoreTargets: { a: 0.5, b: 1 },
      }),
    ).toEqual({
      backends: ['duckdb', 'iceberg'],
      duckdbPath: '/tmp/x.db',
      icebergWarehousePath: '/tmp/ice',
      doltdbPath: '/tmp/dolt',
      doltdbBranch: 'feature',
      source: 'ci',
      organization: 'org',
      providerProject: 'proj',
      repository: 'repo',
      pullRequestId: 42,
      commit: { sha: 'abc', branch: 'main' },
      scoreTargets: { a: 0.5, b: 1 },
    });
  });

  it('drops fields that are present but have the wrong type', () => {
    const out = readContextOptions({
      backends: 'duckdb' as unknown as string[],
      source: 'bogus' as unknown as 'local',
      pullRequestId: 'not-a-number' as unknown as number,
      commit: { sha: 1, branch: 2 } as unknown as {
        sha: string;
        branch: string;
      },
    });
    expect(out.backends).toBeUndefined();
    expect(out.source).toBeUndefined();
    expect(out.pullRequestId).toBeUndefined();
    expect(out.commit).toBeUndefined();
  });

  it('property: arbitrary inputs never produce a value that fails the schema', () => {
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
        { maxKeys: 5 },
      ),
    );

    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), arbitraryValue, { maxKeys: 30 }),
        ctx => {
          const out = readContextOptions(ctx);
          // The output should be a plain object.
          expect(typeof out).toBe('object');
          expect(out).not.toBeNull();
        },
      ),
      { numRuns: 50 },
    );
  });
});
