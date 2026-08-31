import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sourceUrl = new URL('../resources/deepseek-harness.svg', import.meta.url)
const iconUrl = new URL('../resources/deepseek-harness.icns', import.meta.url)

describe('desktop icon assets', () => {
  it('uses the official black whale on a static 1024-pixel white board', () => {
    const source = readFileSync(fileURLToPath(sourceUrl), 'utf8')
    expect(source).toContain('viewBox="0 0 1024 1024"')
    expect(source).toContain('fill="#fff"')
    expect(source).toContain('fill="#000"')
    expect(source).not.toContain('prefers-color-scheme')
    expect(source).not.toContain('<text')
  })

  it('ships a macOS icon container with a 1024-pixel representation', () => {
    const icon = readFileSync(fileURLToPath(iconUrl))
    expect(icon.subarray(0, 4).toString('ascii')).toBe('icns')
    expect(icon.includes(Buffer.from('ic10'))).toBe(true)
  })
})
