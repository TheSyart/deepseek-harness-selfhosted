import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import config from '../vite.config.ts'

describe('desktop renderer Vite aliases', () => {
  it('resolve only to modules present in the current client source tree', () => {
    const aliases = (config as {
      resolve?: { alias?: readonly { replacement: string }[] }
    }).resolve?.alias ?? []
    const missing = aliases
      .map(alias => alias.replacement)
      .filter(replacement => !existsSync(replacement))

    expect(missing).toEqual([])
  })
})
