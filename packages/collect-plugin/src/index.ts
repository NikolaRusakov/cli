import { collectPlugin } from './lib/portal-plugin.js';

export default collectPlugin;

export {
  type PortalConfig,
  type PortalQueryOptions,
  type PortalStorage,
  type RunRecord,
  type RunSource,
  type StorageBackend,
} from './lib/storages/index.js';
export {
  createDoltDBStorage,
  createDuckDBStorage,
  createIcebergStorage,
} from './lib/storages/index.js';
export {
  closePortalStorages,
  createPortalStorages,
  parsePortalConfigFromEnv,
  saveToPortal,
  type BackendStorage,
  type PortalSaveResult,
} from './lib/portal.js';
export {
  type PortalPluginOptions,
  portalPluginOptionsSchema,
} from './lib/config.js';
export {
  buildRunRecords,
  type RunContext,
  type RunRecordInput,
} from './lib/record.js';
export {
  type LegacyRunRecord,
  migrateRunRecord,
  migrateRunRecords,
} from './lib/migration.js';
export { PORTAL_CONTEXT_KEY } from './lib/runner-keys.js';
export { collectPlugin };
