import { defineConfig } from 'vite'

export default defineConfig({
  server: { fs: { allow: ['..'] }, port: 5199 },
  build: { target: 'es2022' },
})
