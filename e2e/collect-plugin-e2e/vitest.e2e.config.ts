import { createE2ETestConfig } from '../../testing/test-setup-config/src/index.js';

export default createE2ETestConfig('collect-plugin-e2e', {
  testTimeout: 60_000,
});
