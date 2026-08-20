import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/Russia-s-Website-/' : '/',
  plugins: [react()],
  server: { host: '0.0.0.0', hmr: false },
  preview: { host: '0.0.0.0', allowedHosts: true },
})
