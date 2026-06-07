/* eslint-disable vitest/require-top-level-describe, functional/no-loop-statements */
import fc from 'fast-check';
import { vol } from 'memfs';
import { beforeEach, describe, expect, it } from 'vitest';
import { MEMFS_VOLUME } from '@code-pushup/test-utils';
import {
  type RunContext,
  type RunRecordInput,
  buildRunRecords,
} from './record.js';

const FIXTURE_RUN = {
  plugins: [
    {
      slug: 'eslint',
      audits: [
        { slug: 'no-debugger', issues: [{}, {}] },
        { slug: 'prefer-const', issues: [] },
      ],
    },
  ],
};

beforeEach(() => {
  vol.reset();
});

describe('buildRunRecords', () => {
  it('builds a single standalone record with file contents', () => {
    const reportPath = `${MEMFS_VOLUME}/report.json`;
    const diffPath = `${MEMFS_VOLUME}/diff.json`;
    vol.fromJSON(
      {
        'report.json': JSON.stringify(FIXTURE_RUN),
        'diff.json': '{}',
      },
      MEMFS_VOLUME,
    );

    const records = buildRunRecords(
      [
        {
          reportPath,
          diffPath,
        },
      ],
      {
        commitSha: 'abc123',
        branch: 'main',
        source: 'local',
        startTime: Date.now() - 10,
      },
    );

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      mode: 'standalone',
      commitSha: 'abc123',
      branch: 'main',
      source: 'local',
      newIssuesCount: 2,
    });
    expect(records[0]?.reportJson).toBe(JSON.stringify(FIXTURE_RUN));
    expect(records[0]?.diffJson).toBe('{}');
  });

  it('produces one record per project for monorepo inputs', () => {
    vol.fromJSON(
      {
        'p1.json': '{}',
        'p2.json': '{}',
      },
      MEMFS_VOLUME,
    );

    const records = buildRunRecords(
      [
        {
          mode: 'monorepo',
          project: 'pkg-a',
          reportPath: `${MEMFS_VOLUME}/p1.json`,
        },
        {
          mode: 'monorepo',
          project: 'pkg-b',
          reportPath: `${MEMFS_VOLUME}/p2.json`,
        },
      ],
      {
        commitSha: 'sha',
        branch: 'main',
        source: 'ci',
        organization: 'org',
        providerProject: 'proj',
        repository: 'repo',
        startTime: Date.now(),
      },
    );

    expect(records.map(r => r.project)).toEqual(['pkg-a', 'pkg-b']);
    expect(records.every(r => r.mode === 'monorepo')).toBe(true);
    expect(records[0]).toMatchObject({
      source: 'ci',
      organization: 'org',
      providerProject: 'proj',
      repository: 'repo',
    });
  });

  it('falls back to "{}" when a file is missing', () => {
    const records = buildRunRecords(
      [{ reportPath: `${MEMFS_VOLUME}/does-not-exist.json` }],
      {
        commitSha: 'sha',
        branch: 'main',
        source: 'local',
        startTime: Date.now(),
      },
    );
    expect(records[0]?.reportJson).toBe('{}');
  });

  it('uses inline JSON when provided', () => {
    const records = buildRunRecords(
      [
        {
          reportJson: '{"plugins":[]}',
          diffJson: '{"diffs":[]}',
        },
      ],
      {
        commitSha: 'sha',
        branch: 'main',
        source: 'local',
        startTime: Date.now(),
      },
    );
    expect(records[0]?.reportJson).toBe('{"plugins":[]}');
    expect(records[0]?.diffJson).toBe('{"diffs":[]}');
  });

  it('generates a unique id for each call', () => {
    const a = buildRunRecords([{ reportJson: '{}' }], {
      commitSha: 'sha',
      branch: 'main',
      source: 'local',
      startTime: Date.now(),
    });
    const b = buildRunRecords([{ reportJson: '{}' }], {
      commitSha: 'sha',
      branch: 'main',
      source: 'local',
      startTime: Date.now(),
    });
    expect(a[0]?.id).not.toBe(b[0]?.id);
  });
});

describe('buildRunRecords (property-based)', () => {
  // We hand-roll the run-context (not a fast-check arbitrary) so that the
  // generated RunContext always has the required fields and we don't have
  // to filter rejects.
  const fixedContext: RunContext = {
    commitSha: 'sha',
    branch: 'main',
    source: 'local',
    startTime: 0,
  };

  const fixedInput: RunRecordInput = {
    mode: 'standalone',
    reportJson: '{"plugins":[]}',
  };

  it('returns one record per input, never throws', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constant(fixedInput), { maxLength: 10 }),
        inputs => {
          const out = buildRunRecords(inputs, fixedContext);
          expect(out).toHaveLength(inputs.length);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('emits ISO 8601 timestamps for every record', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constant(fixedInput), { minLength: 1, maxLength: 5 }),
        inputs => {
          const out = buildRunRecords(inputs, fixedContext);
          for (const record of out) {
            expect(() =>
              new Date(record.timestamp).toISOString(),
            ).not.toThrow();
            expect(new Date(record.timestamp).toISOString()).toBe(
              record.timestamp,
            );
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it('uses a fresh UUID per call (all records in a single call share the id)', () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(
        fc.array(fc.constant(fixedInput), { minLength: 1, maxLength: 5 }),
        inputs => {
          const out = buildRunRecords(inputs, fixedContext);
          // All records in a single call share the same id (one logical run).
          const ids = new Set(out.map(r => r.id));
          expect(ids.size).toBe(1);
          seen.add(out[0]!.id);
        },
      ),
      { numRuns: 30 },
    );
    // Different calls should produce different ids.
    expect(seen.size).toBeGreaterThan(1);
  });

  it('propagates commitSha and branch from context into every record', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constant(fixedInput), { maxLength: 5 }),
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        (inputs, commitSha, branch) => {
          const out = buildRunRecords(inputs, {
            commitSha,
            branch,
            source: 'local',
            startTime: 0,
          });
          expect(out.every(r => r.commitSha === commitSha)).toBe(true);
          expect(out.every(r => r.branch === branch)).toBe(true);
        },
      ),
      { numRuns: 30 },
    );
  });
});
