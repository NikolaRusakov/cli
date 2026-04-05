/**
 * Azure DevOps pipeline task entry point.
 *
 * This file is the execution target for the Azure DevOps pipeline task.
 * It reads task inputs, maps them to CP_* environment variables,
 * and then runs the Code PushUp CI integration.
 */

async function main(): Promise<void> {
  // Dynamic import to allow bundling
  const tl = await import('azure-pipelines-task-lib/task.js');

  // Map task inputs to CP_* environment variables
  const inputMappings: [string, string][] = [
    ['bin', 'CP_BIN'],
    ['config', 'CP_CONFIG'],
    ['directory', 'CP_DIRECTORY'],
    ['token', 'CP_AZURE_TOKEN'],
    ['silent', 'CP_SILENT'],
    ['skipComment', 'CP_SKIP_COMMENT'],
    ['detectNewIssues', 'CP_DETECT_NEW_ISSUES'],
    ['debug', 'CP_DEBUG'],
    ['monorepo', 'CP_MONOREPO'],
    ['monorepoTool', 'CP_MONOREPO_TOOL'],
    ['monorepoParallel', 'CP_MONOREPO_PARALLEL'],
    ['monorepoParallelMax', 'CP_MONOREPO_PARALLEL_MAX'],
    ['monorepoProjects', 'CP_MONOREPO_PROJECTS'],
    ['monorepoTask', 'CP_MONOREPO_TASK'],
    ['nxProjectsFilter', 'CP_MONOREPO_NX_PROJECTS_FILTER'],
    ['configPatterns', 'CP_CONFIG_PATTERNS'],
    ['searchCommits', 'CP_SEARCH_COMMITS'],
    ['searchCommitsMax', 'CP_SEARCH_COMMITS_MAX'],
    ['customSourceRef', 'CP_CUSTOM_SOURCE_REF'],
    ['customTargetRef', 'CP_CUSTOM_TARGET_REF'],
  ];

  for (const [inputName, envVar] of inputMappings) {
    const value = tl.getInput(inputName, false);
    if (value) {
      process.env[envVar] = value;
    }
  }

  try {
    const { run } = await import('../../src/lib/run.js');
    await run();
    tl.setResult(tl.TaskResult.Succeeded, 'Code PushUp analysis completed');
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    tl.setResult(tl.TaskResult.Failed, message);
  }
}

main();
