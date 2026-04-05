import type { Comment, ProviderAPIClient } from '@code-pushup/ci';
import { optionalEnv, requiredEnv } from './env.js';

/**
 * Azure DevOps REST API response types.
 * @see https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-threads
 */
type AzureDevOpsThread = {
  id: number;
  comments: AzureDevOpsComment[];
  status: string;
  properties?: Record<string, { $value: string }>;
};

type AzureDevOpsComment = {
  id: number;
  content: string;
  author: {
    displayName: string;
    uniqueName: string;
  };
  commentType: string;
};

type AzureDevOpsListResponse<T> = {
  value: T[];
  count: number;
};

type AzureDevOpsBuildArtifact = {
  id: number;
  name: string;
  resource: {
    type: string;
    url: string;
    downloadUrl: string;
  };
};

type AzureDevOpsBuild = {
  id: number;
  buildNumber: string;
  status: string;
  result: string;
  sourceBranch: string;
};

const CODE_PUSHUP_THREAD_PROPERTY = 'CodePushUp';
const API_VERSION = '7.2';

/**
 * Maximum characters for a PR comment in Azure DevOps.
 * Azure DevOps has a 150,000 character limit for PR thread comments.
 */
const MAX_COMMENT_CHARS = 150_000;

export type AzureDevOpsAPIClientConfig = {
  /** Azure DevOps organization name */
  organization: string;
  /** Azure DevOps project name */
  project: string;
  /** Azure DevOps repository ID or name */
  repositoryId: string;
  /** Pull request ID (number) */
  pullRequestId: number;
  /** Personal Access Token or System.AccessToken for authentication */
  token: string;
  /** Base URL for Azure DevOps (defaults to https://dev.azure.com) */
  baseUrl?: string;
  /** Target branch name for artifact downloads */
  targetBranch?: string;
};

/**
 * Creates an Azure DevOps API client from environment variables.
 * Uses Azure DevOps pipeline predefined variables and CP_* overrides.
 *
 * Required env vars:
 * - SYSTEM_TEAMFOUNDATIONCOLLECTIONURI or SYSTEM_COLLECTIONURI: Organization URL
 * - SYSTEM_TEAMPROJECT: Project name
 * - BUILD_REPOSITORY_ID: Repository ID
 * - SYSTEM_PULLREQUEST_PULLREQUESTID: PR number
 * - CP_AZURE_TOKEN or SYSTEM_ACCESSTOKEN: Authentication token
 */
export function createAzureDevOpsAPIClientFromEnv(): ProviderAPIClient {
  const collectionUri =
    optionalEnv('SYSTEM_TEAMFOUNDATIONCOLLECTIONURI') ??
    requiredEnv('SYSTEM_COLLECTIONURI');
  const { organization, baseUrl } = parseCollectionUri(collectionUri);

  const config: AzureDevOpsAPIClientConfig = {
    organization,
    project: requiredEnv('SYSTEM_TEAMPROJECT'),
    repositoryId: requiredEnv('BUILD_REPOSITORY_ID'),
    pullRequestId: Number(requiredEnv('SYSTEM_PULLREQUEST_PULLREQUESTID')),
    token: requiredEnv('CP_AZURE_TOKEN'),
    baseUrl,
    targetBranch: optionalEnv('SYSTEM_PULLREQUEST_TARGETBRANCHNAME'),
  };

  return createAzureDevOpsAPIClient(config);
}

/**
 * Creates an Azure DevOps ProviderAPIClient from explicit config.
 */
export function createAzureDevOpsAPIClient(
  config: AzureDevOpsAPIClientConfig,
): ProviderAPIClient {
  const {
    organization,
    project,
    repositoryId,
    pullRequestId,
    token,
    baseUrl = 'https://dev.azure.com',
    targetBranch,
  } = config;

  const gitApiBase = `${baseUrl}/${organization}/${project}/_apis/git/repositories/${repositoryId}`;
  const buildApiBase = `${baseUrl}/${organization}/${project}/_apis/build`;

  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`:${token}`).toString('base64')}`,
    'Content-Type': 'application/json',
  };

  async function request<T>(
    url: string,
    options?: RequestInit,
  ): Promise<T> {
    const separator = url.includes('?') ? '&' : '?';
    const fullUrl = `${url}${separator}api-version=${API_VERSION}`;

    const response = await fetch(fullUrl, {
      ...options,
      headers: {
        ...headers,
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Azure DevOps API request failed: ${response.status} ${response.statusText}\n${body}`,
      );
    }

    return response.json() as Promise<T>;
  }

  async function listComments(): Promise<Comment[]> {
    const threads = await request<AzureDevOpsListResponse<AzureDevOpsThread>>(
      `${gitApiBase}/pullRequests/${pullRequestId}/threads`,
    );

    return threads.value
      .filter(isCodePushUpThread)
      .flatMap(thread =>
        thread.comments
          .filter(comment => comment.commentType === 'text')
          .map(comment => threadCommentToComment(thread, comment)),
      );
  }

  async function createComment(body: string): Promise<Comment> {
    const thread = await request<AzureDevOpsThread>(
      `${gitApiBase}/pullRequests/${pullRequestId}/threads`,
      {
        method: 'POST',
        body: JSON.stringify({
          comments: [{ parentCommentId: 0, content: body, commentType: 1 }],
          status: 4, // closed - no action needed
          properties: {
            [CODE_PUSHUP_THREAD_PROPERTY]: {
              type: 'System.String',
              value: 'true',
            },
          },
        }),
      },
    );

    const firstComment = thread.comments[0];
    if (!firstComment) {
      throw new Error('Azure DevOps API returned thread with no comments');
    }

    return threadCommentToComment(thread, firstComment);
  }

  async function updateComment(id: number, body: string): Promise<Comment> {
    // id is encoded as threadId * 1_000_000 + commentId
    const threadId = Math.floor(id / 1_000_000);
    const commentId = id % 1_000_000;

    const updatedComment = await request<AzureDevOpsComment>(
      `${gitApiBase}/pullRequests/${pullRequestId}/threads/${threadId}/comments/${commentId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ content: body }),
      },
    );

    return {
      id,
      body: updatedComment.content,
      url: buildCommentUrl(
        baseUrl,
        organization,
        project,
        repositoryId,
        pullRequestId,
        threadId,
      ),
    };
  }

  async function downloadReportArtifact(
    projectName?: string,
  ): Promise<string | null> {
    if (!targetBranch) {
      return null;
    }

    try {
      const builds = await request<AzureDevOpsListResponse<AzureDevOpsBuild>>(
        `${buildApiBase}/builds?branchName=refs/heads/${targetBranch}&statusFilter=completed&resultFilter=succeeded&$top=5`,
      );

      if (builds.value.length === 0) {
        return null;
      }

      const artifactName = projectName
        ? `code-pushup-${projectName}`
        : 'code-pushup';

      for (const build of builds.value) {
        try {
          const artifact = await request<AzureDevOpsBuildArtifact>(
            `${buildApiBase}/builds/${build.id}/artifacts?artifactName=${artifactName}`,
          );

          if (artifact.resource?.downloadUrl) {
            const response = await fetch(artifact.resource.downloadUrl, {
              headers,
            });

            if (response.ok) {
              const { writeFile, mkdir } = await import('node:fs/promises');
              const { join } = await import('node:path');
              const { tmpdir } = await import('node:os');

              const dir = join(tmpdir(), 'code-pushup-artifacts');
              await mkdir(dir, { recursive: true });
              const filePath = join(dir, `${artifactName}-report.json`);
              const buffer = Buffer.from(await response.arrayBuffer());
              await writeFile(filePath, buffer);
              return filePath;
            }
          }
        } catch {
          // artifact not found for this build, try next
          continue;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  return {
    maxCommentChars: MAX_COMMENT_CHARS,
    listComments,
    createComment,
    updateComment,
    downloadReportArtifact,
  };
}

function isCodePushUpThread(thread: AzureDevOpsThread): boolean {
  // Check for CodePushUp property marker
  if (thread.properties?.[CODE_PUSHUP_THREAD_PROPERTY]?.$value === 'true') {
    return true;
  }
  // Fallback: check if first comment contains the CI identifier
  const firstComment = thread.comments[0];
  return firstComment?.content?.includes('generated by @code-pushup/ci') ?? false;
}

/**
 * Encodes thread ID and comment ID into a single numeric ID.
 * Azure DevOps uses separate thread and comment IDs, but the ProviderAPIClient
 * interface expects a single numeric ID. We encode both as:
 *   compositeId = threadId * 1_000_000 + commentId
 */
function threadCommentToComment(
  thread: AzureDevOpsThread,
  comment: AzureDevOpsComment,
): Comment {
  return {
    id: thread.id * 1_000_000 + comment.id,
    body: comment.content,
    url: '',
  };
}

function buildCommentUrl(
  baseUrl: string,
  organization: string,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  threadId: number,
): string {
  return `${baseUrl}/${organization}/${project}/_git/${repositoryId}/pullrequest/${pullRequestId}?_a=files&discussionId=${threadId}`;
}

/**
 * Parses the Azure DevOps collection URI to extract organization and base URL.
 *
 * Supports both formats:
 * - https://dev.azure.com/{org}/
 * - https://{org}.visualstudio.com/
 */
export function parseCollectionUri(uri: string): {
  organization: string;
  baseUrl: string;
} {
  const trimmedUri = uri.replace(/\/+$/, '');

  // Format: https://dev.azure.com/{org}
  const devAzureMatch = trimmedUri.match(
    /^(https?:\/\/dev\.azure\.com)\/([^/]+)$/,
  );
  if (devAzureMatch) {
    return {
      organization: devAzureMatch[2]!,
      baseUrl: devAzureMatch[1]!,
    };
  }

  // Format: https://{org}.visualstudio.com
  const vsMatch = trimmedUri.match(
    /^https?:\/\/([^.]+)\.visualstudio\.com$/,
  );
  if (vsMatch) {
    return {
      organization: vsMatch[1]!,
      baseUrl: 'https://dev.azure.com',
    };
  }

  throw new Error(
    `Unable to parse Azure DevOps collection URI: ${uri}. ` +
      'Expected format: https://dev.azure.com/{org}/ or https://{org}.visualstudio.com/',
  );
}
