import { optionalEnv, requiredEnv } from './env.js';
import { parseCollectionUri } from './api.js';

export type PullRequestStatusState =
  | 'notSet'
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'error'
  | 'notApplicable';

export type PullRequestStatusContext = {
  name: string;
  genre: string;
};

export type PullRequestStatus = {
  state: PullRequestStatusState;
  description: string;
  targetUrl?: string;
  context: PullRequestStatusContext;
};

const API_VERSION = '7.2';
const STATUS_CONTEXT_GENRE = 'code-pushup';
const STATUS_CONTEXT_NAME = 'analysis';

/**
 * Posts a PR status (CI check) on the current pull request.
 * This provides a visual indicator in the Azure DevOps PR UI
 * separate from the comment thread.
 *
 * @see https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-statuses
 */
export async function setPullRequestStatus(
  state: PullRequestStatusState,
  description: string,
  targetUrl?: string,
): Promise<void> {
  const collectionUri =
    optionalEnv('SYSTEM_TEAMFOUNDATIONCOLLECTIONURI') ??
    requiredEnv('SYSTEM_COLLECTIONURI');
  const { organization, baseUrl } = parseCollectionUri(collectionUri);
  const project = requiredEnv('SYSTEM_TEAMPROJECT');
  const repositoryId = requiredEnv('BUILD_REPOSITORY_ID');
  const pullRequestId = requiredEnv('SYSTEM_PULLREQUEST_PULLREQUESTID');
  const token = requiredEnv('CP_AZURE_TOKEN');

  const url =
    `${baseUrl}/${organization}/${project}/_apis/git/repositories/${repositoryId}` +
    `/pullRequests/${pullRequestId}/statuses?api-version=${API_VERSION}`;

  const status: PullRequestStatus = {
    state,
    description,
    ...(targetUrl && { targetUrl }),
    context: {
      name: STATUS_CONTEXT_NAME,
      genre: STATUS_CONTEXT_GENRE,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`:${token}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(status),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to set PR status: ${response.status} ${response.statusText}\n${body}`,
    );
  }
}
