import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Dev-only shutdown endpoint so the app's Quit button can stop the server
 * (no more `pkill -f vite`). Not present in a production build.
 */
function quitEndpoint() {
  return {
    name: 'quit-endpoint',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__quit', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end('POST only')
        }
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: true }))
        server.config.logger.info('\n  Shutdown requested from the app — stopping Bard Browser.\n')
        // let the response flush before tearing the server down
        setTimeout(async () => {
          try { await server.close() } finally { process.exit(0) }
        }, 120)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), quitEndpoint()],
})
