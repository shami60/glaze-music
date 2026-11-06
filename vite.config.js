import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * The renderer ships a strict CSP (see index.html) with no `unsafe-eval`, because
 * nothing in `src/` uses `eval` or `new Function`. The Vite dev server, however,
 * is happier with it available for HMR module re-evaluation. Rather than weaken
 * the production policy, relax it only while serving.
 */
function devOnlyUnsafeEval() {
  return {
    name: 'glaze-dev-csp-relax',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(
        "script-src 'self';",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval';"
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), devOnlyUnsafeEval()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    watch: {
      // Only app source should trigger HMR. Watching everything means unrelated
      // files (caches, build output, notes) reload the running app mid-test.
      ignored: [
        '**/dist-electron/**',
        '**/dist/**',
        '**/build/**',
        '**/yt_cache/**',
        '**/yt_cache_test/**',
        '**/.workbuddy-ai/**',
      ]
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
