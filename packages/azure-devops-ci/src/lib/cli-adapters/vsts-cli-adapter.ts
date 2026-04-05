import type { Comment, ProviderAPIClient } from '@code-pushup/ci';
import {
  type CLIAdapterConfig,
  execCommand,
  parseJSONOutput,
} from './types.js';

const MAX_COMMENT_CHARS = 150_000;

type VstsThread = {
  id: number;
  comments: { id: number; content: string; commentType: string }[];
  status: string;
  properties?: Record<string, { $value: string }>;
};

/**
 * Creates a ProviderAPIClient backed by the legacy VSTS CLI (`vsts`).
 *
 * Command mapping to modern az CLI equivalents:
 *   vsts code pr list         → az repos pr list
 *   vsts code pr show         → az repos pr show
 *   vsts code pr create       → az repos pr create
 *   vsts code pr update       → az repos pr update
 *   vsts code pr abandon      → az repos pr update --status abandoned
 *   vsts code pr complete     → az repos pr update --status completed
 *   vsts code pr reactivate   → az repos pr update --status active
 *   vsts code pr set-vote     → az repos pr set-vote
 *   vsts code pr reviewers *  → az repos pr reviewer *
 *   vsts code pr policies *   → az repos pr policy *
 *   vsts code pr work-items * → az repos pr work-item *
 *   vsts code repo *          → az repos *
 *   vsts build list           → az pipelines build list
 *   vsts build show           → az pipelines build show
 *   vsts build queue          → az pipelines build queue
 *   vsts build definition *   → az pipelines build definition *
 *
 * @see https://github.com/Azure/azure-devops-cli-extension/blob/master/doc/command_mapping.md
 *
 * @deprecated Prefer 'az' or 'rest' backend. VSTS CLI is no longer maintained.
 */
export function createVstsCLIClient(
  config: CLIAdapterConfig,
): ProviderAPIClient {
  const { organization, project, repositoryId, pullRequestId, token } = config;

  const instanceUrl = `https://dev.azure.com/${organization}`;

  const envVars: Record<string, string> = {
    ...(token && { VSTS_CLI_PAT: token }),
  };

  function baseArgs(): string[] {
    return [
      '--instance',
      instanceUrl,
      '--project',
      project,
      '--output',
      'json',
    ];
  }

  async function vstsCommand(args: string[]): Promise<string> {
    const result = await execCommand(
      'vsts',
      [...args, ...baseArgs()],
      envVars,
    );

    if (result.exitCode !== 0) {
      throw new Error(
        `vsts command failed (exit ${result.exitCode}): ${result.stderr}`,
      );
    }

    return result.stdout;
  }

  /**
   * VSTS CLI does not have native thread listing commands.
   * We fall back to calling the REST API via the VSTS CLI's
   * HTTP request capability or direct fetch with the token.
   */
  async function listComments(): Promise<Comment[]> {
    const url =
      `${instanceUrl}/${project}/_apis/git/repositories/${repositoryId}` +
      `/pullRequests/${pullRequestId}/threads?api-version=7.2`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`:${token ?? ''}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(
        `VSTS list threads failed: ${response.status} ${response.statusText}`,
      );
    }

    const threads = (await response.json()) as { value: VstsThread[] };

    return threads.value
      .filter(isCodePushUpThread)
      .flatMap(thread =>
        thread.comments
          .filter(c => c.commentType === 'text')
          .map(c => ({
            id: thread.id * 1_000_000 + c.id,
            body: c.content,
            url: '',
          })),
      );
  }

  async function createComment(body: string): Promise<Comment> {
    const url =
      `${instanceUrl}/${project}/_apis/git/repositories/${repositoryId}` +
      `/pullRequests/${pullRequestId}/threads?api-version=7.2`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`:${token ?? ''}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        comments: [{ parentCommentId: 0, content: body, commentType: 1 }],
        status: 4,
        properties: {
          CodePushUp: { type: 'System.String', value: 'true' },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(
        `VSTS create thread failed: ${response.status} ${response.statusText}`,
      );
    }

    const thread = (await response.json()) as VstsThread;
    const first = thread.comments[0];
    if (!first) {
      throw new Error('Thread created with no comments');
    }

    return {
      id: thread.id * 1_000_000 + first.id,
      body: first.content,
      url: '',
    };
  }

  async function updateComment(id: number, body: string): Promise<Comment> {
    const threadId = Math.floor(id / 1_000_000);
    const commentId = id % 1_000_000;

    const url =
      `${instanceUrl}/${project}/_apis/git/repositories/${repositoryId}` +
      `/pullRequests/${pullRequestId}/threads/${threadId}/comments/${commentId}?api-version=7.2`;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Basic ${Buffer.from(`:${token ?? ''}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: body }),
    });

    if (!response.ok) {
      throw new Error(
        `VSTS update comment failed: ${response.status} ${response.statusText}`,
      );
    }

    const updated = (await response.json()) as { content: string };
    return { id, body: updated.content, url: '' };
  }

  async function downloadReportArtifact(
    projectName?: string,
  ): Promise<string | null> {
    try {
      // vsts build list --top 5
      const output = await vstsCommand([
        'build',
        'list',
        '--top',
        '5',
      ]);

      const builds = parseJSONOutput<
        { id: number; sourceBranch: string; result: string }[]
      >(output);

      const succeeded = builds.filter(b => b.result === 'succeeded');
      if (succeeded.length === 0) {
        return null;
      }

      const artifactName = projectName
        ? `code-pushup-${projectName}`
        : 'code-pushup';

      // VSTS CLI doesn't have artifact download, use REST API
      for (const build of succeeded) {
        try {
          const url =
            `${instanceUrl}/${project}/_apis/build/builds/${build.id}` +
            `/artifacts?artifactName=${artifactName}&api-version=7.2`;

          const response = await fetch(url, {
            headers: {
              Authorization: `Basic ${Buffer.from(`:${token ?? ''}`).toString('base64')}`,
            },
          });

          if (!response.ok) {
            continue;
          }

          const artifact = (await response.json()) as {
            resource?: { downloadUrl?: string };
          };

          if (artifact.resource?.downloadUrl) {
            const dlResponse = await fetch(artifact.resource.downloadUrl, {
              headers: {
                Authorization: `Basic ${Buffer.from(`:${token ?? ''}`).toString('base64')}`,
              },
            });

            if (dlResponse.ok) {
              const { writeFile, mkdir } = await import('node:fs/promises');
              const { join } = await import('node:path');
              const { tmpdir } = await import('node:os');

              const dir = join(tmpdir(), 'code-pushup-artifacts');
              await mkdir(dir, { recursive: true });
              const filePath = join(dir, `${artifactName}-report.json`);
              const buffer = Buffer.from(await dlResponse.arrayBuffer());
              await writeFile(filePath, buffer);
              return filePath;
            }
          }
        } catch {
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

function isCodePushUpThread(thread: VstsThread): boolean {
  if (thread.properties?.['CodePushUp']?.$value === 'true') {
    return true;
  }
  const first = thread.comments[0];
  return first?.content?.includes('generated by @code-pushup/ci') ?? false;
}
