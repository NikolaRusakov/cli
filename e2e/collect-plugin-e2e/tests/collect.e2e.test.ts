/* eslint-disable n/no-sync, vitest/no-conditional-expect, vitest/require-top-level-describe */
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDuckDBStorage } from '@code-pushup/collect-plugin';
import { readJsonFile } from '@code-pushup/utils';

const CLI = join(
  __dirname,
  '..',
  '..',
  '..',
  'packages',
  'cli',
  'src',
  'index.ts',
);

const GIT_AVAILABLE = (() => {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const itIfGit = GIT_AVAILABLE ? it : it.skip;

describe('PLUGIN collect via CLI with @code-pushup/collect-plugin', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'collect-plugin-e2e-'));
    mkdirSync(dir, { recursive: true });

    // The CLI is run via tsx, so we need a tsconfig that points back to the
    // workspace root. We use the root tsconfig.base.json for path aliases.
    const config = `
import collectPlugin from '@code-pushup/collect-plugin';

export default {
  plugins: [
    collectPlugin({
      backends: ['duckdb'],
      duckdbPath: ${JSON.stringify(join(dir, 'portal.duckdb'))},
    }),
  ],
};
`;
    writeFileSync(join(dir, 'code-pushup.config.ts'), config);

    // A trivial "reportable" config — collectPlugin produces one audit
    // (persist-runs) which is enough to drive a full collect run.
    const packageJson = {
      name: 'collect-plugin-e2e-fixture',
      version: '0.0.0',
      type: 'module',
    };
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify(packageJson, null, 2),
    );

    dbPath = join(dir, 'portal.duckdb');
  });

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  itIfGit(
    'persists a DuckDB row when the CLI runs code-pushup collect',
    { timeout: 60_000 },
    async () => {
      // Run the CLI via tsx.
      const result = execSync(
        `npx tsx --tsconfig=tsconfig.base.json ${CLI} collect --config=${join(
          dir,
          'code-pushup.config.ts',
        )} --persist.outputDir=${join(dir, '.code-pushup')} --persist.format=json`,
        {
          cwd: process.cwd(),
          env: { ...process.env, TSX_TSCONFIG_PATH: 'tsconfig.base.json' },
          stdio: 'pipe',
        },
      ).toString();

      // The CLI may emit non-JSON lines; just make sure it didn't throw.
      expect(result).toBeDefined();

      // The collect-plugin should have written a DuckDB file.
      const reportJson = await readJsonFile(
        join(dir, '.code-pushup', 'report.json'),
      );
      expect(reportJson).toBeTruthy();
      expect(
        Array.isArray((reportJson as { plugins?: unknown[] }).plugins),
      ).toBe(true);

      // Verify the DuckDB row is queryable.
      const storage = createDuckDBStorage(dbPath);
      await storage.initialize();
      const runs = await storage.queryRuns({ limit: 1 });
      expect(runs.length).toBe(1);
      expect(runs[0]).toMatchObject({
        source: 'local',
      });
      // The commit/branch are auto-detected from the workspace's git state.
      const gitSha = execSync('git rev-parse HEAD', {
        encoding: 'utf-8',
      }).trim();
      expect(runs[0]?.commitSha).toBe(gitSha);
      await storage.close();
    },
  );
});
