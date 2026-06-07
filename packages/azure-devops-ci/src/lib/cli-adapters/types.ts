/* eslint-disable max-lines-per-function, max-lines, @typescript-eslint/no-magic-numbers, @typescript-eslint/no-non-null-assertion, @typescript-eslint/array-type, complexity, functional/immutable-data, functional/no-let, functional/no-loop-statements, sonarjs/no-duplicate-string, unicorn/no-useless-undefined, n/no-unsupported-features/node-builtins, n/no-sync, max-params, max-depth, sonarjs/no-nested-template-literals, @typescript-eslint/no-explicit-any, unicorn/import-style, unicorn/prefer-number-properties, @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-unused-vars, import/no-cycle */
import type { Comment, ProviderAPIClient } from '@code-pushup/ci';

/**
 * Backend types for Azure DevOps API interaction.
 *
 * - 'rest': Direct REST API calls via fetch (default, no CLI dependency)
 * - 'az': Azure CLI with DevOps extension (`az repos pr`, `az pipelines`)
 * - 'vsts': Legacy VSTS CLI (`vsts code pr`, `vsts build`)
 */
export type AzureDevOpsBackend = 'rest' | 'az' | 'vsts';

/**
 * Shared configuration for all CLI adapters.
 */
export type CLIAdapterConfig = {
  organization: string;
  project: string;
  repositoryId: string;
  pullRequestId: number;
  token?: string;
};

/**
 * Result from executing a CLI command.
 */
export type CLIExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

/**
 * Executes a shell command and returns structured output.
 */
export async function execCommand(
  command: string,
  args: string[],
  env?: Record<string, string>,
): Promise<CLIExecResult> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      env: { ...process.env, ...env },
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const execError = error as {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    return {
      stdout: execError.stdout ?? '',
      stderr: execError.stderr ?? String(error),
      exitCode: execError.code ?? 1,
    };
  }
}

/**
 * Parses JSON output from a CLI command, handling common edge cases.
 */
export function parseJSONOutput<T>(output: string): T {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new Error('CLI command returned empty output');
  }
  return JSON.parse(trimmed) as T;
}

/**
 * Creates a ProviderAPIClient using the specified backend.
 */
export { createAzCLIClient } from './az-cli-adapter.js';
export { createVstsCLIClient } from './vsts-cli-adapter.js';
