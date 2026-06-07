/* eslint-disable n/no-sync, vitest/require-top-level-describe, vitest/no-conditional-expect, vitest/require-hook, vitest/no-standalone-expect, vitest/padding-around-test-blocks, max-lines-per-function, @typescript-eslint/no-explicit-any, @nx/enforce-module-boundaries */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunResult } from '@code-pushup/ci';
import { createDuckDBStorage } from '@code-pushup/collect-plugin';
import { buildInputsFromRunResult } from './run-helpers.js';

const FIXTURE_REPORT = {
  commit: { hash: 'abc', message: 'msg', author: 'a', date: 'd' },
  packageName: 'demo',
  version: '1.0.0',
  date: '2026-06-01',
  duration: 1,
  plugins: [],
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'azure-devops-ci-run-'));
});

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe('buildInputsFromRunResult', () => {
  it('builds a single standalone input', () => {
    const reportPath = path.join(dir, 'report.json');
    writeFileSync(reportPath, JSON.stringify(FIXTURE_REPORT));
    const result: RunResult = {
      mode: 'standalone',
      files: { current: { json: reportPath, md: 'x' } },
    };
    const inputs = buildInputsFromRunResult(result);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      mode: 'standalone',
      reportPath,
    });
  });

  it('builds one input per project for monorepo', () => {
    const a = path.join(dir, 'a.json');
    const b = path.join(dir, 'b.json');
    writeFileSync(a, '{}');
    writeFileSync(b, '{}');
    const result: RunResult = {
      mode: 'monorepo',
      files: { comparison: { md: 'x' } },
      projects: [
        {
          name: 'pkg-a',
          files: { current: { json: a, md: 'x' } },
          newIssues: [{ message: 'a' }],
        },
        {
          name: 'pkg-b',
          files: { current: { json: b, md: 'x' } },
          newIssues: [],
        },
      ],
    };
    const inputs = buildInputsFromRunResult(result);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({
      mode: 'monorepo',
      project: 'pkg-a',
      newIssuesCount: 1,
    });
    expect(inputs[1]).toMatchObject({
      mode: 'monorepo',
      project: 'pkg-b',
      newIssuesCount: 0,
    });
  });

  it('passes the diff path when present', () => {
    const reportPath = path.join(dir, 'report.json');
    const diffPath = path.join(dir, 'diff.json');
    writeFileSync(reportPath, '{}');
    writeFileSync(diffPath, '{}');
    const result: RunResult = {
      mode: 'standalone',
      files: {
        current: { json: reportPath, md: 'x' },
        comparison: { json: diffPath, md: 'x' },
      },
    };
    const inputs = buildInputsFromRunResult(result);
    expect(inputs[0]?.diffPath).toBe(diffPath);
  });
});

describe('saveToPortal integration (via buildInputsFromRunResult)', () => {
  it('persists a real DuckDB row for the full pipeline', async () => {
    const reportPath = path.join(dir, 'report.json');
    writeFileSync(reportPath, JSON.stringify(FIXTURE_REPORT));
    const result: RunResult = {
      mode: 'standalone',
      files: { current: { json: reportPath, md: 'x' } },
    };
    const inputs = buildInputsFromRunResult(result);

    // The full saveToPortal pipeline, used by run.ts in azure-devops-ci.
    const { saveToPortal } = await import('@code-pushup/collect-plugin');
    const dbPath = path.join(dir, 'portal.duckdb');
    const storage = createDuckDBStorage(dbPath);
    await saveToPortal(
      inputs,
      {
        commitSha: 'abc123def4567890',
        branch: 'main',
        pullRequestId: 42,
        source: 'ci',
        organization: 'my-org',
        providerProject: 'my-project',
        repository: 'my-repo',
        startTime: Date.now(),
      },
      [{ backend: 'duckdb', storage }],
    );

    const fresh = createDuckDBStorage(dbPath);
    await fresh.initialize();
    const rows = await fresh.queryRuns({ branch: 'main' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      commitSha: 'abc123def4567890',
      branch: 'main',
      source: 'ci',
      providerProject: 'my-project',
      organization: 'my-org',
      repository: 'my-repo',
    });
    await fresh.close();
  });
});
