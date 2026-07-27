import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dev server owns the page and proxies /api to Fastify, so the client can
// always use same-origin relative URLs — no CORS, no base-URL config.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5311,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5310', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
})
