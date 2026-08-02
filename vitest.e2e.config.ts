import { configDefaults, defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    environment: 'node',
    include: ['web/src/styles/viewport.test.ts'],
    exclude: [...configDefaults.exclude, '**/node_modules/**'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
