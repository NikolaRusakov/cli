import type { Options } from '@code-pushup/ci';
import { parseConfigPatternsFromString } from '@code-pushup/ci';
import type { MonorepoTool } from '@code-pushup/utils';
import {
  optionalBooleanEnv,
  optionalEnv,
  optionalNumberEnv,
} from './env.js';

/**
 * Parses Code PushUp options from CP_* environment variables.
 * These map to the same environment variables used by the GitLab CI integration,
 * ensuring consistency across providers.
 *
 * @see Options type from @code-pushup/ci
 */
export function parseOptionsFromEnv(): Options {
  const monorepo = parseMonorepoOption();
  const parallel = parseParallelOption();
  const projects = parseProjectsOption();

  return {
    ...(monorepo != null && { monorepo }),
    ...(parallel != null && { parallel }),
    ...(projects != null && { projects }),
    ...parseStringOption('task', 'CP_MONOREPO_TASK'),
    ...parseStringOption('nxProjectsFilter', 'CP_MONOREPO_NX_PROJECTS_FILTER'),
    ...parseStringOption('bin', 'CP_BIN'),
    ...parseStringOption('config', 'CP_CONFIG'),
    ...parseStringOption('directory', 'CP_DIRECTORY'),
    ...parseBooleanOption('silent', 'CP_SILENT'),
    ...parseBooleanOption('detectNewIssues', 'CP_DETECT_NEW_ISSUES'),
    ...parseBooleanOption('skipComment', 'CP_SKIP_COMMENT'),
    ...parseConfigPatternsOption(),
    ...parseSearchCommitsOption(),
    ...parseJobIdOption(),
  };
}

function parseMonorepoOption(): boolean | MonorepoTool | undefined {
  const monorepoTool = optionalEnv('CP_MONOREPO_TOOL');
  if (monorepoTool) {
    return monorepoTool as MonorepoTool;
  }

  return optionalBooleanEnv('CP_MONOREPO');
}

function parseParallelOption(): boolean | number | undefined {
  const maxParallel = optionalNumberEnv('CP_MONOREPO_PARALLEL_MAX');
  if (maxParallel != null) {
    return maxParallel;
  }
  return optionalBooleanEnv('CP_MONOREPO_PARALLEL');
}

function parseProjectsOption(): string[] | null | undefined {
  const projects = optionalEnv('CP_MONOREPO_PROJECTS');
  if (projects == null) {
    return undefined;
  }
  return projects
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);
}

function parseStringOption(
  key: string,
  envVar: string,
): Record<string, string> {
  const value = optionalEnv(envVar);
  return value != null ? { [key]: value } : {};
}

function parseBooleanOption(
  key: string,
  envVar: string,
): Record<string, boolean> {
  const value = optionalBooleanEnv(envVar);
  return value != null ? { [key]: value } : {};
}

function parseConfigPatternsOption(): Pick<Options, 'configPatterns'> {
  const value = optionalEnv('CP_CONFIG_PATTERNS');
  if (value == null) {
    return {};
  }
  const configPatterns = parseConfigPatternsFromString(value);
  return configPatterns ? { configPatterns } : {};
}

function parseSearchCommitsOption(): Pick<Options, 'searchCommits'> {
  const max = optionalNumberEnv('CP_SEARCH_COMMITS_MAX');
  if (max != null) {
    return { searchCommits: max };
  }
  const enabled = optionalBooleanEnv('CP_SEARCH_COMMITS');
  return enabled != null ? { searchCommits: enabled } : {};
}

function parseJobIdOption(): Pick<Options, 'jobId'> {
  const jobId =
    optionalEnv('CP_JOB_ID') ?? optionalEnv('SYSTEM_JOBID');
  return jobId != null ? { jobId } : {};
}
