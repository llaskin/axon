import type { Plugin } from 'vite'
import { resolve, join } from 'path'
import { homedir } from 'os'
import { WebSocketServer } from 'ws'
import { setupTerminalWs } from './src/lib/terminalWs'
import { createAxonMiddleware, handleAxonUpgrade, setupCleanupHandlers } from './src/server/axonMiddleware'

export function axonDevApi(): Plugin {
  const AXON_HOME = resolve(join(homedir(), '.axon'))

  return {
    name: 'axon-dev-api',
    configureServer(server) {
      // --- Terminal WebSocket server ---
      const wss = new WebSocketServer({ noServer: true })
      setupTerminalWs(wss)

      // Handle WebSocket upgrade ONLY for terminal path
      server.httpServer?.on('upgrade', (req, socket, head) => {
        const handled = handleAxonUpgrade(wss, req, socket, head)
        if (!handled) {
          // Non-matching upgrades (e.g. /__vite_hmr) fall through to Vite
        }
      })

      // Cleanup terminals on server shutdown
      setupCleanupHandlers(server.httpServer ?? undefined)

      // Mount API middleware
      server.middlewares.use(createAxonMiddleware({
        axonHome: AXON_HOME,
        cliDir: resolve(__dirname, '..', 'cli'),
      }))
    }
  }
}
