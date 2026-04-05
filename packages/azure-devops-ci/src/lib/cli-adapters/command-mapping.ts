/**
 * VSTS CLI to Azure DevOps CLI (az) command mapping.
 *
 * This module provides a reference mapping between the legacy VSTS CLI commands
 * and their modern Azure DevOps CLI equivalents, plus a utility to translate
 * VSTS commands to az commands at runtime.
 *
 * @see https://github.com/Azure/azure-devops-cli-extension/blob/master/doc/command_mapping.md
 */

export type CommandMapping = {
  vsts: string;
  az: string;
  notes?: string;
};

/**
 * Complete VSTS CLI → Azure CLI command mapping table.
 *
 * Key namespace changes:
 * - `vsts build` / `vsts release` → `az pipelines`
 * - `vsts code pr` / `vsts code repo` → `az repos`
 * - `vsts work item` → `az boards`
 * - `vsts package` → `az artifacts`
 * - `vsts project` / `vsts admin` → `az devops`
 */
export const COMMAND_MAPPINGS: readonly CommandMapping[] = [
  // Configuration & Auth
  { vsts: 'vsts configure', az: 'az devops configure' },
  { vsts: 'vsts feedback', az: 'az feedback' },
  {
    vsts: 'vsts login',
    az: 'az login',
    notes: 'az devops login for PAT-only auth',
  },
  {
    vsts: 'vsts logout',
    az: 'az logout',
    notes: 'az devops logout for PAT-only auth',
  },

  // Admin - Banners
  { vsts: 'vsts admin banner add', az: 'az devops admin banner add' },
  { vsts: 'vsts admin banner list', az: 'az devops admin banner list' },
  { vsts: 'vsts admin banner remove', az: 'az devops admin banner remove' },
  { vsts: 'vsts admin banner show', az: 'az devops admin banner show' },
  { vsts: 'vsts admin banner update', az: 'az devops admin banner update' },

  // Builds → Pipelines
  { vsts: 'vsts build list', az: 'az pipelines build list' },
  { vsts: 'vsts build queue', az: 'az pipelines build queue' },
  { vsts: 'vsts build show', az: 'az pipelines build show' },
  {
    vsts: 'vsts build definition list',
    az: 'az pipelines build definition list',
  },
  {
    vsts: 'vsts build definition show',
    az: 'az pipelines build definition show',
  },
  { vsts: 'vsts build task list', az: 'az pipelines build task list' },
  { vsts: 'vsts build task show', az: 'az pipelines build task show' },

  // Pull Requests → Repos PR
  {
    vsts: 'vsts code pr abandon',
    az: 'az repos pr update --status abandoned',
    notes: 'Consolidated into az repos pr update --status',
  },
  {
    vsts: 'vsts code pr complete',
    az: 'az repos pr update --status completed',
    notes: 'Consolidated into az repos pr update --status',
  },
  { vsts: 'vsts code pr create', az: 'az repos pr create' },
  { vsts: 'vsts code pr list', az: 'az repos pr list' },
  {
    vsts: 'vsts code pr reactivate',
    az: 'az repos pr update --status active',
    notes: 'Consolidated into az repos pr update --status',
  },
  { vsts: 'vsts code pr set-vote', az: 'az repos pr set-vote' },
  { vsts: 'vsts code pr show', az: 'az repos pr show' },
  { vsts: 'vsts code pr update', az: 'az repos pr update' },
  { vsts: 'vsts code pr policies list', az: 'az repos pr policy list' },
  { vsts: 'vsts code pr policies queue', az: 'az repos pr policy queue' },
  { vsts: 'vsts code pr reviewers add', az: 'az repos pr reviewer add' },
  { vsts: 'vsts code pr reviewers list', az: 'az repos pr reviewer list' },
  {
    vsts: 'vsts code pr reviewers remove',
    az: 'az repos pr reviewer remove',
  },
  { vsts: 'vsts code pr work-items add', az: 'az repos pr work-item add' },
  {
    vsts: 'vsts code pr work-items list',
    az: 'az repos pr work-item list',
  },
  {
    vsts: 'vsts code pr work-items remove',
    az: 'az repos pr work-item remove',
  },

  // Repositories → Repos
  { vsts: 'vsts code repo create', az: 'az repos create' },
  { vsts: 'vsts code repo list', az: 'az repos list' },
  { vsts: 'vsts code repo show', az: 'az repos show' },

  // Packages → Artifacts
  {
    vsts: 'vsts package universal download',
    az: 'az artifacts universal download',
  },
  {
    vsts: 'vsts package universal publish',
    az: 'az artifacts universal publish',
  },

  // Projects → DevOps
  { vsts: 'vsts project create', az: 'az devops project create' },
  { vsts: 'vsts project list', az: 'az devops project list' },
  { vsts: 'vsts project show', az: 'az devops project show' },

  // Releases → Pipelines
  { vsts: 'vsts release list', az: 'az pipelines release list' },
  { vsts: 'vsts release create', az: 'az pipelines release create' },
  { vsts: 'vsts release show', az: 'az pipelines release show' },
  {
    vsts: 'vsts release definition list',
    az: 'az pipelines release definition list',
  },
  {
    vsts: 'vsts release definition show',
    az: 'az pipelines release definition show',
  },

  // Work Items → Boards
  { vsts: 'vsts work item create', az: 'az boards work-item create' },
  { vsts: 'vsts work item show', az: 'az boards work-item show' },
  { vsts: 'vsts work item update', az: 'az boards work-item update' },
  { vsts: 'vsts work item query', az: 'az boards query' },
] as const;

/**
 * Translates a VSTS CLI command to its Azure CLI equivalent.
 * Returns null if no mapping is found.
 */
export function translateVstsToAz(vstsCommand: string): string | null {
  const mapping = COMMAND_MAPPINGS.find(m => m.vsts === vstsCommand);
  return mapping?.az ?? null;
}

/**
 * Translates an Azure CLI command back to its VSTS CLI equivalent.
 * Returns null if no mapping is found.
 */
export function translateAzToVsts(azCommand: string): string | null {
  const mapping = COMMAND_MAPPINGS.find(m => m.az === azCommand);
  return mapping?.vsts ?? null;
}

/**
 * Returns all mappings for a given namespace (e.g., 'build', 'code pr', 'repos').
 */
export function getMappingsForNamespace(
  namespace: string,
): readonly CommandMapping[] {
  return COMMAND_MAPPINGS.filter(
    m => m.vsts.includes(namespace) || m.az.includes(namespace),
  );
}
