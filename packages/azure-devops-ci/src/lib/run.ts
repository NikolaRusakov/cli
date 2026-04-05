import { runInCI } from '@code-pushup/ci';
import {
  createAzureDevOpsAPIClient,
  createAzureDevOpsAPIClientFromEnv,
  type AzureDevOpsAPIClientConfig,
} from './api.js';
import { parseOptionsFromEnv } from './options.js';
import { isPullRequestPipeline, parseGitRefs } from './refs.js';
import { setPullRequestStatus } from './status.js';

/**
 * Main entry point for the Azure DevOps CI integration.
 *
 * 1. Parses git refs from Azure DevOps pipeline variables
 * 2. Creates the Azure DevOps API client for PR interactions
 * 3. Parses Code PushUp options from environment variables
 * 4. Sets a "pending" PR status check
 * 5. Delegates to the platform-agnostic @code-pushup/ci runInCI
 * 6. Updates PR status to "succeeded" or "failed"
 */
export async function run(): Promise<void> {
  const refs = parseGitRefs();
  const api = createAzureDevOpsAPIClientFromEnv();
  const options = parseOptionsFromEnv();
  const isPR = isPullRequestPipeline();

  console.info('Code PushUp Azure DevOps CI');
  console.info(`  Head: ${formatRef(refs.head)}`);
  if (refs.base) {
    console.info(`  Base: ${formatRef(refs.base)}`);
  }
  console.info(`  Mode: ${isPR ? 'Pull Request' : 'Branch push'}`);

  if (isPR) {
    await trySetStatus('pending', 'Code PushUp analysis in progress...');
  }

  try {
    const result = await runInCI(refs, api, options);

    console.info(`Code PushUp completed in ${result.mode} mode`);
    if (result.commentId) {
      console.info(`  Comment ID: ${result.commentId}`);
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
