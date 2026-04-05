import { run } from './lib/run.js';

run().catch((error: unknown) => {
  console.error(
    '❌ Code PushUp Azure DevOps CI failed:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
