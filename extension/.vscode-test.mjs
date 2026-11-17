import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'test/integration/**/*.test.cjs',
  workspaceFolder: 'test/fixture-workspace',
  launchArgs: ['--disable-extensions'],
  mocha: { ui: 'tdd', timeout: 30000 },
});
