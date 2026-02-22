import type { FastifyPluginAsync } from 'fastify'
import { newProjectId } from '@claude-ui/shared'
import { discoverProjects, type DiscoveredProject } from './scanner.js'
import type { RunnerConfig } from '../config/schema.js'
import type { Logger } from '@claude-ui/shared'
import { projectStore } from '../sessions/router.js'

interface ProjectsRouterOpts {
  config: RunnerConfig
  logger: Logger
}

const projectsRouter: FastifyPluginAsync<ProjectsRouterOpts> = async (fastify, opts) => {
  // GET /api/v1/projects — list all discovered projects
  fastify.get(
    '/api/v1/projects',
    { preHandler: [fastify.authenticate] },
    async (_request, _reply) => {
      const discovered = discoverProjects({
        roots: opts.config.projects.roots,
        scanDepth: opts.config.projects.scanDepth,
        importClaudeProjects: opts.config.projects.importClaudeProjects,
        logger: opts.logger,
      })

      const projectsList = discovered.map((p: DiscoveredProject) => ({
        id: newProjectId(), // deterministic in real impl; stateless scan for now
        name: p.name,
        rootPath: p.rootPath,
        gitRemote: p.gitRemote,
        gitBranch: p.gitBranch,
        isDirty: p.isDirty,
        lastSessionAt: p.lastSessionAt,
      }))

      // Populate projectStore so sessions can reference projects
      for (const p of projectsList) {
        projectStore.set(p.id, { id: p.id, path: p.rootPath, name: p.name })
      }

      return { projects: projectsList }
    },
  )
}

export default projectsRouter
