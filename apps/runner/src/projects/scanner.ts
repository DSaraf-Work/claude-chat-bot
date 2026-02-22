import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import type { Logger } from '@claude-ui/shared'

export interface DiscoveredProject {
  rootPath: string
  name: string
  gitRemote?: string
  gitBranch?: string
  isDirty: boolean
  lastSessionAt?: string
}

function isGitRepo(dir: string): boolean {
  return fs.existsSync(path.join(dir, '.git'))
}

function tryGitInfo(dir: string): { remote?: string; branch?: string; isDirty: boolean } {
  try {
    const branch = execFileSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim()
    const remote = execFileSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim()
    const status = execFileSync('git', ['-C', dir, 'status', '--porcelain'], {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim()
    return { branch, remote, isDirty: status.length > 0 }
  } catch {
    return { isDirty: false }
  }
}

function makeProject(rootPath: string, gitInfo: { remote?: string; branch?: string; isDirty: boolean }): DiscoveredProject {
  return {
    rootPath,
    name: path.basename(rootPath),
    ...(gitInfo.remote !== undefined ? { gitRemote: gitInfo.remote } : {}),
    ...(gitInfo.branch !== undefined ? { gitBranch: gitInfo.branch } : {}),
    isDirty: gitInfo.isDirty,
  }
}

function scanDir(root: string, depth: number, maxDepth: number, results: DiscoveredProject[]): void {
  if (depth > maxDepth) return
  if (!fs.existsSync(root)) return

  if (isGitRepo(root)) {
    const gitInfo = tryGitInfo(root)
    results.push(makeProject(root, gitInfo))
    return // don't recurse into nested repos
  }

  try {
    const entries = fs.readdirSync(root, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        scanDir(path.join(root, entry.name), depth + 1, maxDepth, results)
      }
    }
  } catch {
    // permission denied etc — skip
  }
}

function readClaudeProjects(logger: Logger): DiscoveredProject[] {
  const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects')
  if (!fs.existsSync(claudeProjectsDir)) return []

  const results: DiscoveredProject[] = []
  try {
    const entries = fs.readdirSync(claudeProjectsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      // ~/.claude/projects dirs are encoded project paths
      const decodedPath = entry.name.replace(/-/g, '/')
      if (fs.existsSync(decodedPath) && isGitRepo(decodedPath)) {
        const gitInfo = tryGitInfo(decodedPath)
        results.push(makeProject(decodedPath, gitInfo))
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to read ~/.claude/projects')
  }
  return results
}

export interface ScanOptions {
  roots: string[]
  scanDepth: number
  importClaudeProjects: boolean
  logger: Logger
}

export function discoverProjects(opts: ScanOptions): DiscoveredProject[] {
  const seen = new Set<string>()
  const results: DiscoveredProject[] = []

  function addIfNew(p: DiscoveredProject): void {
    if (!seen.has(p.rootPath)) {
      seen.add(p.rootPath)
      results.push(p)
    }
  }

  // Scan configured roots
  for (const root of opts.roots) {
    const found: DiscoveredProject[] = []
    scanDir(root, 0, opts.scanDepth, found)
    found.forEach(addIfNew)
  }

  // Import from ~/.claude/projects
  if (opts.importClaudeProjects) {
    readClaudeProjects(opts.logger).forEach(addIfNew)
  }

  return results
}
