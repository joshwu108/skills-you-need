import { defineConfig } from 'vitest/config';

// Unit tests only. The integration tests need a VS Code host; see .vscode-test.mjs.
export default defineConfig({ test: { include: ['test/unit/**/*.test.ts'] } });
