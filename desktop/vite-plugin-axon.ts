import type { Plugin } from 'vite'
import { readdir, readFile } from 'fs/promises'
import { join, resolve } from 'path'
import { homedir } from 'os'

export function axonDevApi(): Plugin {
  const AXON_HOME = resolve(join(homedir(), '.axon'))

  return {
    name: 'axon-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/axon')) return next()

        res.setHeader('Content-Type', 'application/json')

        try {
          // GET /api/axon/projects
          if (req.url === '/api/axon/projects') {
            const wsDir = join(AXON_HOME, 'workspaces')
            const entries = await readdir(wsDir, { withFileTypes: true })
            const projects = []

            for (const entry of entries) {
              if (!entry.isDirectory()) continue
              const name = entry.name
              const wsPath = join(wsDir, name)

              let status = 'active'
              let projectPath = ''
              let createdAt = ''
              try {
                const cfg = await readFile(join(wsPath, 'config.yaml'), 'utf-8')
                status = cfg.match(/^status:\s*(.+)$/m)?.[1]?.trim() || 'active'
                projectPath = cfg.match(/^project_path:\s*(.+)$/m)?.[1]?.trim() || ''
                createdAt = cfg.match(/^created_at:\s*(.+)$/m)?.[1]?.trim() || ''
              } catch {}

              let lastRollup: string | null = null
              let openLoopCount = 0
              try {
                const state = await readFile(join(wsPath, 'state.md'), 'utf-8')
                lastRollup = state.match(/^last_rollup:\s*(.+)$/m)?.[1]?.trim() || null
                const loops = state.match(/^\s*- \[[ >]\]/gm)
                openLoopCount = loops ? loops.length : 0
              } catch {}

              let episodeCount = 0
              try {
                const eps = await readdir(join(wsPath, 'episodes'))
                episodeCount = eps.filter(f => f.endsWith('.md')).length
              } catch {}

              projects.push({ name, path: projectPath, status, createdAt, lastRollup, episodeCount, openLoopCount })
            }

            res.end(JSON.stringify(projects))
            return
          }

          // GET /api/axon/projects/:name/rollups
          const rollupsMatch = req.url.match(/^\/api\/axon\/projects\/([^/]+)\/rollups$/)
          if (rollupsMatch) {
            const project = decodeURIComponent(rollupsMatch[1])
            const epDir = join(AXON_HOME, 'workspaces', project, 'episodes')

            try {
              const files = await readdir(epDir)
              const mdFiles = files.filter(f => f.endsWith('.md')).sort().reverse()

              const rollups = []
              for (const file of mdFiles) {
                const content = await readFile(join(epDir, file), 'utf-8')
                rollups.push({ filename: file, content })
              }
              res.end(JSON.stringify(rollups))
            } catch {
              res.end(JSON.stringify([]))
            }
            return
          }

          // GET /api/axon/projects/:name/state
          const stateMatch = req.url.match(/^\/api\/axon\/projects\/([^/]+)\/state$/)
          if (stateMatch) {
            const project = decodeURIComponent(stateMatch[1])
            try {
              const content = await readFile(join(AXON_HOME, 'workspaces', project, 'state.md'), 'utf-8')
              res.end(JSON.stringify({ content }))
            } catch {
              res.end(JSON.stringify({ content: '' }))
            }
            return
          }

          // GET /api/axon/projects/:name/config
          const configMatch = req.url.match(/^\/api\/axon\/projects\/([^/]+)\/config$/)
          if (configMatch) {
            const project = decodeURIComponent(configMatch[1])
            try {
              const content = await readFile(join(AXON_HOME, 'workspaces', project, 'config.yaml'), 'utf-8')
              res.end(JSON.stringify({ content }))
            } catch {
              res.end(JSON.stringify({ content: '' }))
            }
            return
          }

          // GET /api/axon/projects/:name/stream
          const streamMatch = req.url.match(/^\/api\/axon\/projects\/([^/]+)\/stream$/)
          if (streamMatch) {
            const project = decodeURIComponent(streamMatch[1])
            try {
              const content = await readFile(join(AXON_HOME, 'workspaces', project, 'stream.md'), 'utf-8')
              res.end(JSON.stringify({ content }))
            } catch {
              res.end(JSON.stringify({ content: '' }))
            }
            return
          }

          res.statusCode = 404
          res.end(JSON.stringify({ error: 'Not found' }))
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(e) }))
        }
      })
    }
  }
}
