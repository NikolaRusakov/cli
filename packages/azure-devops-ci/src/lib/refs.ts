import type { GitRefs } from '@code-pushup/ci';
import { optionalEnv, requiredEnv } from './env.js';

/**
 * Azure DevOps predefined pipeline variables used for git refs:
 *
 * - BUILD_SOURCEBRANCHNAME: Short name of the branch (e.g. 'main', 'feature/xyz')
 * - BUILD_SOURCEVERSION: Full commit SHA of the head
 * - SYSTEM_PULLREQUEST_SOURCEBRANCH: Full ref of the PR source (e.g. 'refs/heads/feature/xyz')
 * - SYSTEM_PULLREQUEST_SOURCECOMMITID: Commit SHA for the PR source
 * - SYSTEM_PULLREQUEST_TARGETBRANCH: Full ref of the PR target (e.g. 'refs/heads/main')
 * - SYSTEM_PULLREQUEST_TARGETBRANCHNAME: Short name of the PR target branch
 *
 * Custom overrides:
 * - CP_CUSTOM_SOURCE_REF: Override source ref
 * - CP_CUSTOM_TARGET_REF: Override target ref
 *
 * @see https://learn.microsoft.com/en-us/azure/devops/pipelines/build/variables
 */
export function parseGitRefs(): GitRefs {
  const customSourceRef = optionalEnv('CP_CUSTOM_SOURCE_REF');
  const customTargetRef = optionalEnv('CP_CUSTOM_TARGET_REF');

  if (customSourceRef) {
    return {
      head: customSourceRef,
      ...(customTargetRef && { base: customTargetRef }),
    };
  }

  const isPullRequest = isPullRequestPipeline();

  if (isPullRequest) {
    return parsePullRequestRefs();
  }

  return parseBranchRefs();
}

/**
 * Determines if the current pipeline is running for a pull request.
 */
export function isPullRequestPipeline(): boolean {
  const reason = optionalEnv('BUILD_REASON');
  return reason === 'PullRequest';
}

function parsePullRequestRefs(): GitRefs {
  const sourceBranch = stripRefsPrefix(
    requiredEnv('SYSTEM_PULLREQUEST_SOURCEBRANCH'),
  );
  const sourceCommit = optionalEnv('SYSTEM_PULLREQUEST_SOURCECOMMITID');
  const targetBranch =
    optionalEnv('SYSTEM_PULLREQUEST_TARGETBRANCHNAME') ??
    stripRefsPrefix(requiredEnv('SYSTEM_PULLREQUEST_TARGETBRANCH'));
  const customTargetRef = optionalEnv('CP_CUSTOM_TARGET_REF');

  return {
    head: sourceCommit
      ? { ref: sourceBranch, sha: sourceCommit }
      : sourceBranch,
    base: customTargetRef ?? targetBranch,
  };
}

function parseBranchRefs(): GitRefs {
  const branchName = requiredEnv('BUILD_SOURCEBRANCHNAME');
  const commitSha = optionalEnv('BUILD_SOURCEVERSION');
  const customTargetRef = optionalEnv('CP_CUSTOM_TARGET_REF');

  return {
    head: commitSha ? { ref: branchName, sha: commitSha } : branchName,
    ...(customTargetRef && { base: customTargetRef }),
  };
}

function stripRefsPrefix(ref: string): string {
  return ref.replace(/^refs\/heads\//, '');
}
