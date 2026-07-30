import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  server: {
    port: 5311,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5310', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
})
