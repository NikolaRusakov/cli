# @code-pushup/azure-devops-ci

Azure DevOps CI integration for [Code PushUp](https://code-pushup.dev/).

Automates code quality feedback in Azure DevOps pull requests by running Code PushUp analysis and posting comparison results as PR comments.

## Features

- Runs Code PushUp CLI to collect code quality metrics
- Compares reports between source and target branches
- Posts or updates PR comments with quality comparison summaries
- Supports monorepo mode (Nx, Turbo, Yarn, pnpm, npm workspaces)
- Detects new issues introduced in changed files
- Downloads baseline reports from build artifacts
- Available as an Azure DevOps pipeline task (marketplace extension) or standalone npm package

## Installation

### As an Azure DevOps Extension

Install the **Code PushUp** extension from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/) into your Azure DevOps organization.

Then use the task in your pipeline:

```yaml
trigger:
  - main

pool:
  vmImage: 'ubuntu-latest'

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '22.x'

  - script: npm ci
    displayName: 'Install dependencies'

  - task: CodePushUp@0
    inputs:
      token: $(System.AccessToken)
    displayName: 'Run Code PushUp'
```

### As an npm Package

```bash
npm install -D @code-pushup/azure-devops-ci
```

Use directly in your pipeline script:

```yaml
trigger:
  - main

pr:
  - main

pool:
  vmImage: 'ubuntu-latest'

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '22.x'

  - script: npm ci
    displayName: 'Install dependencies'

  - script: npx --yes @code-pushup/azure-devops-ci
    displayName: 'Run Code PushUp'
    env:
      CP_AZURE_TOKEN: $(System.AccessToken)
```

## Environment Variables

### Required

| Variable | Description |
| --- | --- |
| `CP_AZURE_TOKEN` | Azure DevOps PAT or `$(System.AccessToken)` for API access |

### Azure DevOps Pipeline Variables (automatic)

These are set automatically by Azure DevOps pipelines:

| Variable | Description |
| --- | --- |
| `SYSTEM_TEAMFOUNDATIONCOLLECTIONURI` | Organization URL |
| `SYSTEM_TEAMPROJECT` | Project name |
| `BUILD_REPOSITORY_ID` | Repository ID |
| `BUILD_REASON` | Build trigger reason (e.g. `PullRequest`) |
| `BUILD_SOURCEBRANCHNAME` | Source branch name |
| `BUILD_SOURCEVERSION` | Source commit SHA |
| `SYSTEM_PULLREQUEST_PULLREQUESTID` | Pull request ID |
| `SYSTEM_PULLREQUEST_SOURCEBRANCH` | PR source branch ref |
| `SYSTEM_PULLREQUEST_SOURCECOMMITID` | PR source commit SHA |
| `SYSTEM_PULLREQUEST_TARGETBRANCH` | PR target branch ref |
| `SYSTEM_PULLREQUEST_TARGETBRANCHNAME` | PR target branch name |

### Optional Configuration

| Variable | Description | Default |
| --- | --- | --- |
| `CP_BIN` | Custom CLI executable | `npx --no-install code-pushup` |
| `CP_CONFIG` | Config file path | auto-detected |
| `CP_DIRECTORY` | Working directory | current directory |
| `CP_SILENT` | Suppress CLI logs | `false` |
| `CP_SKIP_COMMENT` | Skip PR comment | `false` |
| `CP_DETECT_NEW_ISSUES` | Detect new issues | `true` |
| `CP_DEBUG` | Enable debug logs | `false` |

### Monorepo Options

| Variable | Description | Default |
| --- | --- | --- |
| `CP_MONOREPO` | Enable monorepo mode | `false` |
| `CP_MONOREPO_TOOL` | Tool: `auto`, `nx`, `turbo`, `yarn`, `pnpm`, `npm` | `auto` |
| `CP_MONOREPO_PARALLEL` | Run tasks in parallel | `false` |
| `CP_MONOREPO_PARALLEL_MAX` | Max parallel tasks | unlimited |
| `CP_MONOREPO_PROJECTS` | Comma-separated project folder globs | all projects |
| `CP_MONOREPO_TASK` | Task/target name | `code-pushup` |
| `CP_MONOREPO_NX_PROJECTS_FILTER` | Nx `show projects` args | `--with-target={task}` |

### Advanced Options

| Variable | Description | Default |
| --- | --- | --- |
| `CP_CUSTOM_SOURCE_REF` | Override source branch/tag | auto-detected |
| `CP_CUSTOM_TARGET_REF` | Override target branch/tag | auto-detected |
| `CP_CONFIG_PATTERNS` | Pre-defined persist/upload configs (JSON) | none |
| `CP_SEARCH_COMMITS` | Search previous commits for baseline | `false` |
| `CP_SEARCH_COMMITS_MAX` | Max commits to search | `10` |

## Permissions

To allow the pipeline to post PR comments, the build service identity needs **Contribute to pull requests** permission on the repository.

Go to **Project Settings > Repositories > Security** and grant the `{Project Name} Build Service` identity the permission to contribute to pull requests.

## Programmatic Usage

```typescript
import { createAzureDevOpsAPIClient, runWithConfig } from '@code-pushup/azure-devops-ci';
import { runInCI } from '@code-pushup/ci';

// Using the convenience wrapper
await runWithConfig({
  organization: 'my-org',
  project: 'my-project',
  repositoryId: 'my-repo',
  pullRequestId: 42,
  token: 'my-pat-token',
});

// Or use the API client directly with @code-pushup/ci
const api = createAzureDevOpsAPIClient({
  organization: 'my-org',
  project: 'my-project',
  repositoryId: 'my-repo',
  pullRequestId: 42,
  token: 'my-pat-token',
});

const result = await runInCI(
  { head: 'feature/my-branch', base: 'main' },
  api,
  { monorepo: false },
);
```

## Publishing to Visual Studio Marketplace

```bash
# Install the TFX CLI
npm install -g tfx-cli

# Build and package the extension
cd packages/azure-devops-ci
tfx extension create --manifest-globs vss-extension.json

# Publish (requires a publisher account)
tfx extension publish --manifest-globs vss-extension.json --token <PAT>
```
