import { defineConfig } from '@vscode/test-cli';
import path from 'path';

export default defineConfig({
	files: 'out/test/**/*.test.js',
  workspaceFolder: path.resolve("src", "test", "test-workspace"),
  // The clipboard cut action command wasn't actually copying the text in newer versions :(
  version: '1.96.0',
  env: {
    TEST_MODE: true,
  },
  mocha: {
    timeout: 60000,
    slow: 800,
  },
});
