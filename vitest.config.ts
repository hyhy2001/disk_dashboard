import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Most tests are plain Node — SQLite queries and pure layout maths — so `node` is
// the default environment. Component tests (*.test.tsx) need a DOM, and the
// viewport tests drive a real browser through playwright, which also runs in node.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['{server,web,shared}/**/*.test.{ts,tsx}'],
    environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
    setupFiles: ['./web/src/test-setup.ts'],
    // Report a clear failure rather than hanging if a DB handle is left open.
    testTimeout: 20_000,
  },
})
