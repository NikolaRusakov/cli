import 'dotenv/config';
import {
  configureCoveragePlugin,
  configureEslintPlugin,
  configureJsDocsPlugin,
  configureTypescriptPlugin,
  configureUpload,
} from '../../code-pushup.preset.js';
import { mergeConfigs } from '../utils/src/index.js';
import { collectPlugin } from './src/index.js';

const projectName = 'collect-plugin';

export default mergeConfigs(
  configureUpload(projectName),
  await configureEslintPlugin(projectName),
  await configureCoveragePlugin(projectName),
  await configureTypescriptPlugin(projectName),
  configureJsDocsPlugin(projectName),
  {
    plugins: [
      collectPlugin({
        backends: ['duckdb'],
        duckdbPath: `.code-pushup/${projectName}.duckdb`,
      }),
    ],
  },
);
