import { describe, expect, it } from 'vitest'

describe('desktop main runtime', () => {
  it('supplies the packaged entry path when Electron omits argv[1]', async () => {
    const modulePath = '../src/main-runtime.ts'
    const runtime = await import(modulePath).catch(() => undefined) as
      | { ensureMainEntryArgument?: (argv: string[], entryPath: string) => void }
      | undefined
    const argv = ['/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness']

    runtime?.ensureMainEntryArgument?.(argv, '/Applications/DeepSeek Harness.app/Contents/Resources/app/lib/main.js')

    expect(argv).toEqual([
      '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness',
      '/Applications/DeepSeek Harness.app/Contents/Resources/app/lib/main.js',
    ])
  })
})
