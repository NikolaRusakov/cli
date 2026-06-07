/* eslint-disable @typescript-eslint/array-type, functional/no-loop-statements */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { migrateRunRecord, migrateRunRecords } from './migration.js';
import type { RunRecord } from './storages/types.js';

const NEW_SHAPE_KEYS: Readonly<Array<keyof RunRecord>> = [
  'id',
  'timestamp',
  'commitSha',
  'branch',
  'pullRequestId',
  'project',
  'mode',
  'durationMs',
  'score',
  'reportJson',
  'diffJson',
  'newIssuesCount',
  'source',
  'organization',
  'providerProject',
  'repository',
];

describe('migrateRunRecord', () => {
  it('renames azProject to providerProject', () => {
    const out = migrateRunRecord({
      id: 'id-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      commitSha: 'sha',
      branch: 'main',
      mode: 'standalone',
      durationMs: 1,
      reportJson: '{}',
      newIssuesCount: 0,
      azProject: 'my-proj',
    });
    expect(out.providerProject).toBe('my-proj');
    expect('azProject' in out).toBe(false);
  });

  it('defaults source to "ci" when missing', () => {
    const out = migrateRunRecord({
      id: 'id-2',
      timestamp: '2026-01-01T00:00:00.000Z',
      commitSha: 'sha',
      branch: 'main',
      mode: 'standalone',
      durationMs: 1,
      reportJson: '{}',
      newIssuesCount: 0,
    });
    expect(out.source).toBe('ci');
  });

  it('preserves source when provided', () => {
    const out = migrateRunRecord({
      id: 'id-3',
      timestamp: '2026-01-01T00:00:00.000Z',
      commitSha: 'sha',
      branch: 'main',
      mode: 'standalone',
      durationMs: 1,
      reportJson: '{}',
      newIssuesCount: 0,
      source: 'local',
    });
    expect(out.source).toBe('local');
  });

  it('preserves all other fields', () => {
    const out = migrateRunRecord({
      id: 'id-4',
      timestamp: '2026-01-01T00:00:00.000Z',
      commitSha: 'sha',
      branch: 'main',
      mode: 'monorepo',
      project: 'pkg-a',
      pullRequestId: 7,
      durationMs: 1,
      reportJson: '{}',
      diffJson: '{}',
      newIssuesCount: 0,
      organization: 'org',
      repository: 'repo',
    });
    expect(out).toMatchObject({
      id: 'id-4',
      project: 'pkg-a',
      pullRequestId: 7,
      mode: 'monorepo',
      organization: 'org',
      repository: 'repo',
    });
  });

  it('passes a record through unchanged when it already has the new shape', () => {
    const input: RunRecord = {
      id: 'id-5',
      timestamp: '2026-01-01T00:00:00.000Z',
      commitSha: 'sha',
      branch: 'main',
      mode: 'standalone',
      durationMs: 1,
      reportJson: '{}',
      newIssuesCount: 0,
      source: 'local',
      providerProject: 'my-proj',
    };
    const out = migrateRunRecord(input);
    expect(out).toEqual(input);
  });

  it('property: any input produces a valid RunRecord (no legacy keys)', () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.string({ minLength: 1 }),
          timestamp: fc.string({ minLength: 1 }),
          commitSha: fc.string({ minLength: 1 }),
          branch: fc.string({ minLength: 1 }),
          pullRequestId: fc.option(fc.integer({ min: 1 })),
          project: fc.option(fc.string()),
          mode: fc.constantFrom('standalone' as const, 'monorepo' as const),
          durationMs: fc.integer({ min: 0 }),
          score: fc.option(fc.double({ noNaN: true })),
          reportJson: fc.string({ minLength: 1 }),
          diffJson: fc.option(fc.string()),
          newIssuesCount: fc.integer({ min: 0 }),
          organization: fc.option(fc.string()),
          repository: fc.option(fc.string()),
          azProject: fc.option(fc.string()),
          source: fc.option(fc.constantFrom('local' as const, 'ci' as const)),
        }),
        input => {
          const out = migrateRunRecord(input);
          for (const key of NEW_SHAPE_KEYS) {
            expect(key in out).toBe(true);
          }
          expect('azProject' in out).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe('migrateRunRecords', () => {
  it('returns one record per input', () => {
    const out = migrateRunRecords([
      {
        id: '1',
        timestamp: 't',
        commitSha: 'c',
        branch: 'b',
        mode: 'standalone',
        durationMs: 1,
        reportJson: '{}',
        newIssuesCount: 0,
      },
      {
        id: '2',
        timestamp: 't',
        commitSha: 'c',
        branch: 'b',
        mode: 'standalone',
        durationMs: 1,
        reportJson: '{}',
        newIssuesCount: 0,
        azProject: 'p',
      },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]?.source).toBe('ci');
    expect(out[1]?.providerProject).toBe('p');
  });
});
