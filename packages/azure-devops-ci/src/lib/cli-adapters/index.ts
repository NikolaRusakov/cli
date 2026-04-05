export { createAzCLIClient } from './az-cli-adapter.js';
export { createVstsCLIClient } from './vsts-cli-adapter.js';
export {
  COMMAND_MAPPINGS,
  translateVstsToAz,
  translateAzToVsts,
  getMappingsForNamespace,
  type CommandMapping,
} from './command-mapping.js';
export {
  type AzureDevOpsBackend,
  type CLIAdapterConfig,
  type CLIExecResult,
  execCommand,
  parseJSONOutput,
} from './types.js';
