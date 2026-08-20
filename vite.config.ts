import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const runtime = globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }
const isGithubActions = Boolean(runtime.process?.env?.GITHUB_ACTIONS)

export default defineConfig({
  base: isGithubActions ? '/Russia-s-Website-/' : '/',
  plugins: [react()],
  server: { host: '0.0.0.0', hmr: false },
  preview: { host: '0.0.0.0', allowedHosts: true },
})
