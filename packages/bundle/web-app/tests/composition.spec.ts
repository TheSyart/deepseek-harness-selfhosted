/** Web bundle ownership of the Host report and Client Token usage page. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

describe('dsh-web-app Token usage composition', () => {
  it('mounts both planes and makes cold-read concurrency explicit', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const patches = loadOverlayPatches('web-app composition test', resolve(root, 'cordis.patch.yml'))
    const rows = patches.flatMap(patch => patch.insert ?? [])
    const report = rows.find(row => row.id === 'token-usage-report')
    expect(report).toMatchObject({
      name: '@deepseek-ai/dsh-token-usage-report',
      config: { readConcurrency: 8 },
    })
    expect(rows.find(row => row.id === 'ui-settings-token-usage')).toMatchObject({
      name: '@deepseek-ai/dsh-client-ui-settings-token-usage',
    })
    expect(manifest.dependencies).toMatchObject({
      '@deepseek-ai/dsh-token-usage-report': 'workspace:^',
      '@deepseek-ai/dsh-client-ui-settings-token-usage': 'workspace:^',
    })
  })
})
