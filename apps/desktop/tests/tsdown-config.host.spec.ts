import { describe, expect, it } from 'vitest'
import config from '../tsdown.config.ts'

describe('desktop main-process bundling', () => {
  it('keeps Electron as the runtime-provided ESM module', () => {
    const resolve = config as unknown as (context: { env?: Record<string, string> }) => {
      deps?: { neverBundle?: readonly string[] }
    }
    const host = resolve({ env: {} })

    expect(host.deps?.neverBundle).toContain('electron')
  })
})
