import type { FastifyPluginAsync } from 'fastify'
import { newProjectId } from '@claude-ui/shared'
import { discoverProjects, type DiscoveredProject } from './scanner.js'
import type { RunnerConfig } from '../config/schema.js'
import type { Logger } from '@claude-ui/shared'

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

      return {
        projects: discovered.map((p: DiscoveredProject) => ({
          id: newProjectId(), // deterministic in real impl; stateless scan for now
          name: p.name,
          rootPath: p.rootPath,
          gitRemote: p.gitRemote,
          gitBranch: p.gitBranch,
          isDirty: p.isDirty,
          lastSessionAt: p.lastSessionAt,
        })),
      }
    },
  )
}

export default projectsRouter
