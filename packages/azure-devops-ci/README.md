# @code-pushup/azure-devops-ci

Azure DevOps CI integration for [Code PushUp](https://code-pushup.dev/).

Automates code quality feedback in Azure DevOps pull requests by running Code PushUp analysis and posting comparison results as PR comments.

## Features

- Runs Code PushUp CLI to collect code quality metrics
- Compares reports between source and target branches
- Posts or updates PR comments with quality comparison summaries
- Sets PR status checks (pending/succeeded/failed)
- Supports monorepo mode (Nx, Turbo, Yarn, pnpm, npm workspaces)
- Detects new issues introduced in changed files
- Downloads baseline reports from build artifacts
- **Three API backends**: REST API (default), Azure CLI (`az`), or legacy VSTS CLI
- **Portal storage**: Persist run data to DuckDB, Apache Iceberg, or DoltDB
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

## API Backends

Control how the integration communicates with Azure DevOps via `CP_AZURE_BACKEND`:

| Backend | Value | Description |
| --- | --- | --- |
| REST API | `rest` (default) | Direct HTTP calls to Azure DevOps REST API. No external CLI required. |
| Azure CLI | `az` | Uses `az repos pr`, `az pipelines` commands. Requires `az` CLI with `azure-devops` extension. |
| VSTS CLI | `vsts` | Legacy `vsts code pr`, `vsts build` commands. **Deprecated.** |

### Using Azure CLI Backend

```yaml
steps:
  - task: AzureCLI@2
    inputs:
      azureSubscription: 'my-service-connection'
      scriptType: 'bash'
      inlineScript: |
        az extension add --name azure-devops
        az devops configure --defaults organization=$(System.TeamFoundationCollectionUri) project=$(System.TeamProject)
    displayName: 'Configure Azure CLI'

  - script: npx --yes @code-pushup/azure-devops-ci
    displayName: 'Run Code PushUp'
    env:
      CP_AZURE_TOKEN: $(System.AccessToken)
      CP_AZURE_BACKEND: az
      AZURE_DEVOPS_EXT_PAT: $(System.AccessToken)
```

### VSTS CLI to Azure CLI Command Mapping

The package includes a complete command mapping reference for migration:

```typescript
import { translateVstsToAz, COMMAND_MAPPINGS } from '@code-pushup/azure-devops-ci';

// Translate a single command
translateVstsToAz('vsts code pr list');      // → 'az repos pr list'
translateVstsToAz('vsts build list');         // → 'az pipelines build list'
translateVstsToAz('vsts code pr abandon');    // → 'az repos pr update --status abandoned'

// Key namespace changes:
// vsts build *        → az pipelines build *
// vsts release *      → az pipelines release *
// vsts code pr *      → az repos pr *
// vsts code repo *    → az repos *
// vsts work item *    → az boards work-item *
// vsts package *      → az artifacts *
// vsts project *      → az devops project *
```

## Portal Storage

Persist Code PushUp run results for historical analysis using one or more storage backends.

### DuckDB (Default)

Embedded columnar database for fast analytical queries. No server required.

```yaml
env:
  CP_PORTAL_ENABLED: true
  CP_PORTAL_BACKENDS: duckdb
  CP_PORTAL_DUCKDB_PATH: .code-pushup/portal.duckdb
```

```typescript
import { createDuckDBStorage } from '@code-pushup/azure-devops-ci';

const storage = createDuckDBStorage('./portal.duckdb');
await storage.initialize();

// Query historical runs
const runs = await storage.queryRuns({ branch: 'main', limit: 10 });
```

### Apache Iceberg

Schema evolution and time travel for historical data. Handles report schema changes gracefully.

```yaml
env:
  CP_PORTAL_ENABLED: true
  CP_PORTAL_BACKENDS: iceberg
  CP_PORTAL_ICEBERG_PATH: .code-pushup/iceberg-warehouse
```

```typescript
import { createIcebergStorage } from '@code-pushup/azure-devops-ci';

const storage = createIcebergStorage('./iceberg-warehouse');
await storage.initialize();

// Time travel: query data as of a specific snapshot
const runs = await storage.queryRuns({
  icebergSnapshotId: 42,
  branch: 'main',
});

// Or query as of a specific timestamp
const historicalRuns = await storage.queryRuns({
  icebergAsOfTimestamp: '2026-01-15T00:00:00Z',
});
```

### DoltDB

Git-like versioning for run data — branches, diffs, merges, and time travel.

```yaml
env:
  CP_PORTAL_ENABLED: true
  CP_PORTAL_BACKENDS: doltdb
  CP_PORTAL_DOLTDB_PATH: .code-pushup/doltdb
  CP_PORTAL_DOLTDB_BRANCH: main
```

```typescript
import { createDoltDBStorage } from '@code-pushup/azure-devops-ci';

const storage = createDoltDBStorage('./doltdb', 'main');
await storage.initialize();

// Query from a specific Dolt branch
const runs = await storage.queryRuns({ doltBranch: 'analysis/q1' });

// Time travel to a specific Dolt commit
const historicalRuns = await storage.queryRuns({ doltCommit: 'abc123' });
```

### Multiple Backends

Enable multiple backends simultaneously:

```yaml
env:
  CP_PORTAL_ENABLED: true
  CP_PORTAL_BACKENDS: duckdb,doltdb
```

## Environment Variables

### Required

| Variable | Description |
| --- | --- |
| `CP_AZURE_TOKEN` | Azure DevOps PAT or `$(System.AccessToken)` |

### Backend & Portal

| Variable | Description | Default |
| --- | --- | --- |
| `CP_AZURE_BACKEND` | API backend: `rest`, `az`, `vsts` | `rest` |
| `CP_PORTAL_ENABLED` | Enable portal storage | `false` |
| `CP_PORTAL_BACKENDS` | Comma-separated backends: `duckdb`, `iceberg`, `doltdb` | `duckdb` |
| `CP_PORTAL_DUCKDB_PATH` | DuckDB file path | `.code-pushup/portal.duckdb` |
| `CP_PORTAL_ICEBERG_PATH` | Iceberg warehouse directory | `.code-pushup/iceberg-warehouse` |
| `CP_PORTAL_DOLTDB_PATH` | DoltDB repo directory | `.code-pushup/doltdb` |
| `CP_PORTAL_DOLTDB_BRANCH` | DoltDB branch for writes | `main` |

### Azure DevOps Pipeline Variables (automatic)

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
| `SYSTEM_PULLREQUEST_TARGETBRANCH` | PR target branch ref |

### Code PushUp Options

| Variable | Description | Default |
| --- | --- | --- |
| `CP_BIN` | Custom CLI executable | `npx --no-install code-pushup` |
| `CP_CONFIG` | Config file path | auto-detected |
| `CP_DIRECTORY` | Working directory | current directory |
| `CP_SILENT` | Suppress CLI logs | `false` |
| `CP_SKIP_COMMENT` | Skip PR comment | `false` |
| `CP_DETECT_NEW_ISSUES` | Detect new issues | `true` |

### Monorepo Options

| Variable | Description | Default |
| --- | --- | --- |
| `CP_MONOREPO` | Enable monorepo mode | `false` |
| `CP_MONOREPO_TOOL` | Tool: `auto`, `nx`, `turbo`, `yarn`, `pnpm`, `npm` | `auto` |
| `CP_MONOREPO_PARALLEL` | Run tasks in parallel | `false` |
| `CP_MONOREPO_PARALLEL_MAX` | Max parallel tasks | unlimited |
| `CP_MONOREPO_PROJECTS` | Project folder globs (comma-separated) | all |
| `CP_MONOREPO_TASK` | Task/target name | `code-pushup` |
| `CP_MONOREPO_NX_PROJECTS_FILTER` | Nx `show projects` args | `--with-target={task}` |

### Advanced

| Variable | Description | Default |
| --- | --- | --- |
| `CP_CUSTOM_SOURCE_REF` | Override source branch/tag | auto-detected |
| `CP_CUSTOM_TARGET_REF` | Override target branch/tag | auto-detected |
| `CP_CONFIG_PATTERNS` | Persist/upload configs (JSON) | none |
| `CP_SEARCH_COMMITS` | Search previous commits for baseline | `false` |
| `CP_SEARCH_COMMITS_MAX` | Max commits to search | `10` |

## Permissions

The build service identity needs **Contribute to pull requests** permission on the repository.

Go to **Project Settings > Repositories > Security** and grant the `{Project Name} Build Service` identity the permission.

## Programmatic Usage

```typescript
import {
  createAzureDevOpsAPIClient,
  createAzCLIClient,
  createDuckDBStorage,
  createDoltDBStorage,
} from '@code-pushup/azure-devops-ci';
import { runInCI } from '@code-pushup/ci';

// REST API backend
const restApi = createAzureDevOpsAPIClient({
  organization: 'my-org',
  project: 'my-project',
  repositoryId: 'my-repo',
  pullRequestId: 42,
  token: 'my-pat-token',
});

// Or Azure CLI backend
const azApi = createAzCLIClient({
  organization: 'my-org',
  project: 'my-project',
  repositoryId: 'my-repo',
  pullRequestId: 42,
  token: 'my-pat-token',
});

const result = await runInCI(
  { head: 'feature/branch', base: 'main' },
  restApi, // or azApi
  { monorepo: false },
);

// Persist results
const duckdb = createDuckDBStorage('./portal.duckdb');
await duckdb.initialize();
// ... save results
await duckdb.close();
```

## Publishing to Visual Studio Marketplace

```bash
npm install -g tfx-cli
cd packages/azure-devops-ci
tfx extension create --manifest-globs vss-extension.json
tfx extension publish --manifest-globs vss-extension.json --token <PAT>
```
