import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Most tests are plain Node — SQLite queries and pure layout maths — so `node` is
// the default environment. Component tests (*.test.tsx) need a DOM, and the
// viewport tests drive a real browser through playwright, which also runs in node.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'web/src') },
  },
  test: {
    environment: 'node',
    include: ['{server,web,shared}/**/*.test.{ts,tsx}'],
    // The viewport test drives a real browser against the deployed dashboard
    // (https://dashboard.hydev.me), so it is an e2e check, not a unit test. It
    // hangs when that URL is unreachable, so it is excluded from the default run
    // and invoked separately via `npm run test:e2e`.
    exclude: ['web/src/styles/viewport.test.ts'],
    // Component tests are .tsx. The web/src/lib tests also need a DOM — Blob
    // downloads, clipboard, location — without rendering anything. Scoped to lib
    // rather than the whole web tree because the stylesheet test reads files via
    // import.meta.url, which jsdom resolves differently.
    environmentMatchGlobs: [
      ['**/*.test.tsx', 'jsdom'],
      ['web/src/lib/**/*.test.ts', 'jsdom'],
    ],
    setupFiles: ['./web/src/test-setup.ts'],
    // Report a clear failure rather than hanging if a DB handle is left open.
    testTimeout: 20_000,
  },
})
