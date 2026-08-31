import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  DEFAULT_REFRESH_INTERVAL_SECONDS,
  TOKEN_USAGE_SETTINGS_NAMESPACE,
} from '../src/token-usage-settings.ts'
import { apply } from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-settings-token-usage host', () => {
  it('registers the default and accepts only the four supported intervals', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = settingsNamespace(TOKEN_USAGE_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({ refreshIntervalSeconds: DEFAULT_REFRESH_INTERVAL_SECONDS })
    for (const refreshIntervalSeconds of [5, 10, 30, 60]) {
      await ctx.settings.update(ns, { refreshIntervalSeconds })
      expect(ctx.settings.get(ns)).toEqual({ refreshIntervalSeconds })
    }
    await expect(ctx.settings.update(ns, { refreshIntervalSeconds: 15 })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })
})
