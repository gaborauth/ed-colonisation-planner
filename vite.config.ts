/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { renderChangelogPage } from './src/domain/changelogHtml.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Serves the root CHANGELOG.md (semantic-release's own output, not a copy) as two static assets —
// the raw file (hooks/useWhatsNew.ts fetches it at runtime for the "what's new since your last
// visit" dialog) and a rendered changelog.html full-history page (linked from the footer's version
// number, styled like the other public/*.html pages). Deliberately not files committed under
// public/: a copy there would need a separate step to stay in sync with the real CHANGELOG.md, the
// exact drift risk this sidesteps.
function changelogPlugin(): Plugin {
  const changelogPath = resolve(__dirname, 'CHANGELOG.md')
  const readChangelog = () => readFileSync(changelogPath, 'utf-8')

  return {
    name: 'serve-changelog',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0]
        if (url?.endsWith('/CHANGELOG.md')) {
          res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
          res.end(readChangelog())
          return
        }
        if (url?.endsWith('/changelog.html')) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(renderChangelogPage(readChangelog()))
          return
        }
        next()
      })
    },
    generateBundle() {
      const markdown = readChangelog()
      this.emitFile({ type: 'asset', fileName: 'CHANGELOG.md', source: markdown })
      this.emitFile({ type: 'asset', fileName: 'changelog.html', source: renderChangelogPage(markdown) })
    },
  }
}

export default defineConfig({
  // Matches the GitHub Pages repo path this app deploys under (see deploy.yml) — without it,
  // asset URLs would resolve against the domain root instead of the repo subpath.
  base: '/ed-colonisation-planner/',
  plugins: [react(), changelogPlugin()],
  test: {
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
  },
})
