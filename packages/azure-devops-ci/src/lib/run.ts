/* eslint-disable max-lines-per-function, complexity, functional/immutable-data, @nx/enforce-module-boundaries, no-duplicate-imports */
import type { ProviderAPIClient } from '@code-pushup/ci';
import { runInCI } from '@code-pushup/ci';
import type { BackendStorage } from '@code-pushup/collect-plugin';
import { saveToPortal } from '@code-pushup/collect-plugin';
import {
  type AzureDevOpsAPIClientConfig,
  createAzureDevOpsAPIClient,
  createAzureDevOpsAPIClientFromEnv,
  parseCollectionUri,
} from './api.js';
import { createAzCLIClient } from './cli-adapters/az-cli-adapter.js';
import type {
  AzureDevOpsBackend,
  CLIAdapterConfig,
} from './cli-adapters/types.js';
import { createVstsCLIClient } from './cli-adapters/vsts-cli-adapter.js';
import { optionalEnv, requiredEnv } from './env.js';
import { parseOptionsFromEnv } from './options.js';
import {
  closePortalStorages,
  createPortalStorages,
  parsePortalConfigFromEnv,
} from './portal-compat.js';
import { isPullRequestPipeline, parseGitRefs } from './refs.js';
import { buildInputsFromRunResult } from './run-helpers.js';
import { setPullRequestStatus } from './status.js';

/**
 * Resolves which backend to use for Azure DevOps API interactions.
 *
 * CP_AZURE_BACKEND env var:
 * - 'rest' (default): Direct REST API calls via fetch
 * - 'az': Azure CLI with DevOps extension (az repos pr, az pipelines)
 * - 'vsts': Legacy VSTS CLI (vsts code pr, vsts build)
 */
function resolveBackend(): AzureDevOpsBackend {
  const backend = optionalEnv('CP_AZURE_BACKEND');
  if (backend === 'az' || backend === 'vsts' || backend === 'rest') {
    return backend;
  }
  return 'rest';
}

/**
 * Creates the appropriate ProviderAPIClient based on the configured backend.
 */
function createAPIClient(backend: AzureDevOpsBackend): ProviderAPIClient {
  if (backend === 'rest') {
    return createAzureDevOpsAPIClientFromEnv();
  }

  const collectionUri =
    optionalEnv('SYSTEM_TEAMFOUNDATIONCOLLECTIONURI') ??
    requiredEnv('SYSTEM_COLLECTIONURI');
  const { organization } = parseCollectionUri(collectionUri);

  const cliConfig: CLIAdapterConfig = {
    organization,
    project: requiredEnv('SYSTEM_TEAMPROJECT'),
    repositoryId: requiredEnv('BUILD_REPOSITORY_ID'),
    pullRequestId: Number(requiredEnv('SYSTEM_PULLREQUEST_PULLREQUESTID')),
    token: optionalEnv('CP_AZURE_TOKEN'),
  };

  if (backend === 'az') {
    return createAzCLIClient(cliConfig);
  }

  return createVstsCLIClient(cliConfig);
}

/**
 * Main entry point for the Azure DevOps CI integration.
 *
 * 1. Resolves backend (rest / az / vsts)
 * 2. Parses git refs from Azure DevOps pipeline variables
 * 3. Creates the appropriate API client
 * 4. Parses Code PushUp options from environment variables
 * 5. Sets a "pending" PR status check
 * 6. Delegates to the platform-agnostic @code-pushup/ci runInCI
 * 7. Persists results to portal storage (DuckDB / Iceberg / DoltDB)
 * 8. Updates PR status to "succeeded" or "failed"
 */
export async function run(): Promise<void> {
  const startTime = Date.now();
  const backend = resolveBackend();
  const refs = parseGitRefs();
  const api = createAPIClient(backend);
  const options = parseOptionsFromEnv();
  const isPR = isPullRequestPipeline();

  console.info('Code PushUp Azure DevOps CI');
  console.info(`  Backend: ${backend}`);
  console.info(`  Head: ${formatRef(refs.head)}`);
  if (refs.base) {
    console.info(`  Base: ${formatRef(refs.base)}`);
  }
  console.info(`  Mode: ${isPR ? 'Pull Request' : 'Branch push'}`);

  if (isPR) {
    await trySetStatus('pending', 'Code PushUp analysis in progress...');
  }

  // Initialize portal storage
  const portalConfig = parsePortalConfigFromEnv();
  let storages: BackendStorage[] = [];
  if (portalConfig) {
    storages = createPortalStorages(portalConfig);
    console.info(`  Portal: ${portalConfig.backends.join(', ')}`);
  }

  try {
    const result = await runInCI(refs, api, options);

    console.info(`Code PushUp completed in ${result.mode} mode`);
    if (result.commentId) {
      console.info(`  Comment ID: ${result.commentId}`);
    }

    // Persist to portal
    if (storages.length > 0) {
      const collectionUri =
        optionalEnv('SYSTEM_TEAMFOUNDATIONCOLLECTIONURI') ??
        optionalEnv('SYSTEM_COLLECTIONURI') ??
        '';
      const { organization } = collectionUri
        ? parseCollectionUri(collectionUri)
        : { organization: '' };

      const commitSha = typeof refs.head === 'string' ? '' : refs.head.sha;
      const branchName =
        typeof refs.head === 'string' ? refs.head : refs.head.ref;

      const inputs = buildInputsFromRunResult(result);

      try {
        await saveToPortal(
          inputs,
          {
            commitSha,
            branch: branchName,
            pullRequestId: isPR
              ? Number(optionalEnv('SYSTEM_PULLREQUEST_PULLREQUESTID'))
              : undefined,
            source: 'ci',
            organization,
            providerProject: optionalEnv('SYSTEM_TEAMPROJECT') ?? '',
            repository: optionalEnv('BUILD_REPOSITORY_ID') ?? '',
            startTime,
          },
          storages,
        );
        console.info('  Portal: run data persisted');
      } catch (portalError) {
        console.warn(
          `  Portal: failed to persist - ${portalError instanceof Error ? portalError.message : 'unknown error'}`,
        );
      }
    }

    if (isPR) {
      await trySetStatus('succeeded', 'Code PushUp analysis completed');
    }
  } catch (error) {
    if (isPR) {
      await trySetStatus(
        'failed',
        `Code PushUp analysis failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
    throw error;
  } finally {
    await closePortalStorages(storages);
  }
}

/**
 * Programmatic entry point for custom integrations.
 * Allows passing explicit config instead of relying on env vars.
 */
export async function runWithConfig(
  config: AzureDevOpsAPIClientConfig,
): Promise<void> {
  const refs = parseGitRefs();
  const api = createAzureDevOpsAPIClient(config);
  const options = parseOptionsFromEnv();

  await runInCI(refs, api, options);
}

function formatRef(ref: string | { ref: string; sha: string }): string {
  if (typeof ref === 'string') {
    return ref;
  }
  return `${ref.ref} (${ref.sha.slice(0, 8)})`;
}

async function trySetStatus(
  state: 'pending' | 'succeeded' | 'failed',
  description: string,
): Promise<void> {
  try {
    await setPullRequestStatus(state, description);
  } catch (error) {
    console.warn(
      `Failed to set PR status: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
}
