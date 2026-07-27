import { defineConfig } from 'vitest/config'

// One config for both workspaces: the tests are plain Node (SQLite queries and
// pure layout maths), so no jsdom or browser environment is needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['{server,web,shared}/**/*.test.ts'],
    // Report a clear failure rather than hanging if a DB handle is left open.
    testTimeout: 20_000,
  },
})
