import type { Comment, ProviderAPIClient } from '@code-pushup/ci';
import {
  type CLIAdapterConfig,
  execCommand,
  parseJSONOutput,
} from './types.js';

const MAX_COMMENT_CHARS = 150_000;

type AzPRThread = {
  id: number;
  comments: { id: number; content: string; commentType: string }[];
  status: string;
  properties?: Record<string, { $value: string }>;
};

/**
 * Creates a ProviderAPIClient backed by the Azure CLI (`az repos pr`).
 *
 * Requires `az` CLI with the `azure-devops` extension installed.
 * Authentication via AZURE_DEVOPS_EXT_PAT env var or `az login`.
 *
 * Command mapping (from VSTS CLI):
 *   vsts code pr list       → az repos pr list
 *   vsts code pr show       → az repos pr show
 *   vsts code pr create     → az repos pr create
 *   vsts code pr update     → az repos pr update
 *   vsts build list         → az pipelines build list
 *   vsts build show         → az pipelines build show
 *
 * @see https://learn.microsoft.com/en-us/azure/devops/cli/azure-devops-cli-in-yaml
 */
export function createAzCLIClient(
  config: CLIAdapterConfig,
): ProviderAPIClient {
  const { organization, project, repositoryId, pullRequestId, token } = config;

  const orgUrl = `https://dev.azure.com/${organization}`;

  const envVars: Record<string, string> = {
    ...(token && { AZURE_DEVOPS_EXT_PAT: token }),
  };

  function baseArgs(): string[] {
    return ['--org', orgUrl, '--project', project, '--output', 'json'];
  }

  async function azCommand(
    group: string,
    command: string,
    args: string[],
  ): Promise<string> {
    const result = await execCommand(
      'az',
      [group, command, ...args, ...baseArgs()],
      envVars,
    );

    if (result.exitCode !== 0) {
      throw new Error(
        `az ${group} ${command} failed (exit ${result.exitCode}): ${result.stderr}`,
      );
    }

    return result.stdout;
  }

  async function listComments(): Promise<Comment[]> {
    // az repos pr list does not directly list threads;
    // we use the REST-style `az devops invoke` for thread listing
    const output = await azDevOpsInvoke(
      'git',
      'pullRequestThreads',
      'GET',
      `repositories/${repositoryId}/pullRequests/${pullRequestId}/threads`,
    );

    const threads = parseJSONOutput<{ value: AzPRThread[] }>(output);

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
    const payload = JSON.stringify({
      comments: [{ parentCommentId: 0, content: body, commentType: 1 }],
      status: 4,
      properties: {
        CodePushUp: { type: 'System.String', value: 'true' },
      },
    });

    const output = await azDevOpsInvoke(
      'git',
      'pullRequestThreads',
      'POST',
      `repositories/${repositoryId}/pullRequests/${pullRequestId}/threads`,
      payload,
    );

    const thread = parseJSONOutput<AzPRThread>(output);
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

    const payload = JSON.stringify({ content: body });

    const output = await azDevOpsInvoke(
      'git',
      'pullRequestThreadComments',
      'PATCH',
      `repositories/${repositoryId}/pullRequests/${pullRequestId}/threads/${threadId}/comments/${commentId}`,
      payload,
    );

    const updated = parseJSONOutput<{ content: string }>(output);

    return { id, body: updated.content, url: '' };
  }

  async function downloadReportArtifact(
    projectName?: string,
  ): Promise<string | null> {
    try {
      // az pipelines build list --branch <branch> --top 5 --result succeeded
      const buildsOutput = await azCommand('pipelines', 'build list', [
        '--top',
        '5',
        '--result',
        'succeeded',
      ]);

      const builds = parseJSONOutput<
        { id: number; sourceBranch: string }[]
      >(buildsOutput);

      if (builds.length === 0) {
        return null;
      }

      const artifactName = projectName
        ? `code-pushup-${projectName}`
        : 'code-pushup';

      for (const build of builds) {
        try {
          const artifactOutput = await azCommand(
            'pipelines',
            'runs artifact download',
            ['--run-id', String(build.id), '--artifact-name', artifactName, '--path', '/tmp/code-pushup-artifacts'],
          );
          const { join } = await import('node:path');
          const filePath = join(
            '/tmp/code-pushup-artifacts',
            artifactName,
            'report.json',
          );
          const { existsSync } = await import('node:fs');
          if (existsSync(filePath)) {
            return filePath;
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

  /**
   * Uses `az devops invoke` to call Azure DevOps REST API endpoints
   * that don't have dedicated az CLI commands (e.g., PR threads).
   *
   * This is the bridge between az CLI auth and raw REST endpoints.
   */
  async function azDevOpsInvoke(
    area: string,
    resource: string,
    httpMethod: string,
    routeParameters: string,
    body?: string,
  ): Promise<string> {
    const args = [
      'devops',
      'invoke',
      '--area',
      area,
      '--resource',
      resource,
      '--http-method',
      httpMethod,
      '--route-parameters',
      routeParameters,
      '--api-version',
      '7.2',
      ...baseArgs(),
    ];

    if (body) {
      args.push('--in-file', '/dev/stdin');
    }

    // For body, we write to stdin via a temp approach
    if (body) {
      const { writeFileSync, unlinkSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { tmpdir } = await import('node:os');
      const tmpFile = join(tmpdir(), `az-invoke-${Date.now()}.json`);
      writeFileSync(tmpFile, body);

      const bodyArgs = args.filter(a => a !== '/dev/stdin');
      bodyArgs.push('--in-file', tmpFile);

      try {
        const result = await execCommand('az', bodyArgs, envVars);
        if (result.exitCode !== 0) {
          throw new Error(
            `az devops invoke failed (exit ${result.exitCode}): ${result.stderr}`,
          );
        }
        return result.stdout;
      } finally {
        try {
          unlinkSync(tmpFile);
        } catch {
          // ignore cleanup errors
        }
      }
    }

    const result = await execCommand('az', args, envVars);
    if (result.exitCode !== 0) {
      throw new Error(
        `az devops invoke failed (exit ${result.exitCode}): ${result.stderr}`,
      );
    }
    return result.stdout;
  }

  return {
    maxCommentChars: MAX_COMMENT_CHARS,
    listComments,
    createComment,
    updateComment,
    downloadReportArtifact,
  };
}

function isCodePushUpThread(thread: AzPRThread): boolean {
  if (thread.properties?.['CodePushUp']?.$value === 'true') {
    return true;
  }
  const first = thread.comments[0];
  return first?.content?.includes('generated by @code-pushup/ci') ?? false;
}
