import { globSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(readFileSync(
  fileURLToPath(new URL('../package.json', import.meta.url)),
  'utf8',
)) as {
  files?: string[]
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const appBootManifest = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../../packages/boot/app-boot/package.json', import.meta.url)),
  'utf8',
)) as {
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

interface WorkspaceManifest {
  name?: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const workspacePackages = new Map<string, WorkspaceManifest>()
for (const relativePath of globSync([
  'apps/*/package.json',
  'packages/*/*/package.json',
  'vendor/*/package.json',
], { cwd: repositoryRoot })) {
  const candidate = JSON.parse(readFileSync(`${repositoryRoot}/${relativePath}`, 'utf8')) as WorkspaceManifest
  if (candidate.name !== undefined) workspacePackages.set(candidate.name, candidate)
}

describe('desktop package manifest', () => {
  it('keeps the Electron packaging runtime out of production deployment dependencies', () => {
    expect(manifest.dependencies?.electron).toBeUndefined()
    expect(manifest.devDependencies?.electron).toMatch(/^\^37\./u)
  })

  it('ships the generated icon and declares its deterministic renderer', () => {
    expect(manifest.files).toContain('resources')
    expect(manifest.devDependencies?.sharp).toMatch(/^\^0\.35\./u)
  })

  it('provides every required app-boot peer in the production deployment', () => {
    const requiredPeers = Object.keys(appBootManifest.peerDependencies ?? {})
      .filter(name => appBootManifest.peerDependenciesMeta?.[name]?.optional !== true)

    expect(requiredPeers.filter(name => manifest.dependencies?.[name] === undefined)).toEqual([])
  })

  it('provides every workspace peer reachable from the production dependency graph', () => {
    const ordinaryDependencies = new Set<string>()
    const dependencyQueue = Object.keys(manifest.dependencies ?? {})
    for (let name = dependencyQueue.shift(); name !== undefined; name = dependencyQueue.shift()) {
      if (ordinaryDependencies.has(name)) continue
      ordinaryDependencies.add(name)
      const dependency = workspacePackages.get(name)
      if (dependency !== undefined) dependencyQueue.push(...Object.keys(dependency.dependencies ?? {}))
    }

    const visited = new Set<string>()
    const requiredPeers = new Set<string>()
    const queue = Object.keys(manifest.dependencies ?? {})
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      if (visited.has(name)) continue
      visited.add(name)
      const dependency = workspacePackages.get(name)
      if (dependency === undefined) continue
      queue.push(...Object.keys(dependency.dependencies ?? {}))
      for (const peer of Object.keys(dependency.peerDependencies ?? {})) {
        if (!workspacePackages.has(peer)) continue
        requiredPeers.add(peer)
        queue.push(peer)
      }
    }

    expect([...requiredPeers]
      .filter(name => !ordinaryDependencies.has(name) && manifest.dependencies?.[name] === undefined)
      .sort()).toEqual([])
  })
})
