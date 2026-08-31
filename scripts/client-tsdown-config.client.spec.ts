import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { repositoryRootFrom } from '../packages/client/tsdown.client.ts'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

describe('client tsdown workspace discovery', () => {
  it('finds the repository from a package working directory', () => {
    expect(repositoryRootFrom(resolve(ROOT, 'packages/client'))).toBe(ROOT)
  })

  it('fails loud outside a pnpm workspace', () => {
    expect(() => repositoryRootFrom('/')).toThrow(/cannot locate pnpm-workspace\.yaml/)
  })
})
