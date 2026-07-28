/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Matches the GitHub Pages repo path this app deploys under (see deploy.yml) — without it,
  // asset URLs would resolve against the domain root instead of the repo subpath.
  base: '/ed-colonisation-planner/',
  plugins: [react()],
  test: {
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
  },
})
