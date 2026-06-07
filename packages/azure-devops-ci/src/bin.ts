/* eslint-disable functional/immutable-data, unicorn/prefer-top-level-await */
import { run } from './lib/run.js';

run().catch((error: unknown) => {
  console.error(
    '❌ Code PushUp Azure DevOps CI failed:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
