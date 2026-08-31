/** Token usage settings registration and Remote adapter. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import type { TokenUsageSectionInjected } from '../src/client/TokenUsageSection.tsx'
import { TokenUsageSection } from '../src/client/TokenUsageSection.tsx'

function report() {
  return {
    generatedAt: 100,
    timeZone: 'UTC',
    window: { from: '2025-01-01', through: '2025-12-31', days: 365 as const },
    lifetime: { uncachedInputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 },
    coverage: { sessionCount: 1, failedSessionCount: 0 },
    days: [],
  }
}

type StubRemoteResult =
  | { readonly ok: true; readonly value: ReturnType<typeof report> }
  | {
    readonly ok: false
    readonly error: { readonly code: string; readonly message: string; readonly details: Record<string, never> }
  }

async function bench(remoteResult: StubRemoteResult = { ok: true, value: report() }) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const set = vi.fn(async () => {})
  const scope = {
    getSnapshot: () => ({
      status: 'ready' as const,
      value: { refreshIntervalSeconds: 30 as const },
      base: {}, user: {}, revision: 0, writable: true, mode: 'host' as const,
    }),
    subscribe: () => () => {},
    set,
    unset: vi.fn(async () => {}),
  }
  const bind = vi.fn(() => scope)
  ctx.provide('settingsScope', { bind } as never)
  const snapshot = vi.fn(async () => remoteResult)
  ctx.provide('remote', { tokenUsageReport: { snapshot } } as never)
  ctx.provide('remote.tokenUsageReport' as never, { snapshot } as never)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  return { ctx, locale, slots, bind, scope, set, snapshot }
}

describe('ui-settings-token-usage apply', () => {
  it('declares its services and registers the ordered localized page', async () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.tokenUsageReport', 'settingsScope'])
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(TokenUsageSection)
    expect(entry.options).toMatchObject({ id: 'token-usage', order: 12 })
    expect(entry.locale).toBe('settings.tokenUsage')
    expect(resolveSlotLabel(entry.options.label)).toBe('Token 用量')
    expect(b.bind).toHaveBeenCalledWith({ namespace: 'ui-token-usage' })
    const injected = (entry.inject as unknown as () => TokenUsageSectionInjected)()
    expect(injected.hooks.snapshot).toBe(injected.controller.store)
    await injected.controller.refresh()
    expect(b.snapshot).toHaveBeenCalledWith(
      { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' },
      expect.any(AbortSignal),
    )
    expect(injected.controller.store.getSnapshot().snapshot).toEqual(report())
    b.locale.setLocale('en')
    expect(resolveSlotLabel(entry.options.label)).toBe('Token usage')
  })

  it('turns Remote failures into controller errors and frees registrations on teardown', async () => {
    const b = await bench({
      ok: false as const,
      error: { code: 'unavailable', message: 'offline', details: {} },
    })
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('settings.section')[0]!
    const injected = (entry.inject as unknown as () => TokenUsageSectionInjected)()
    await injected.controller.refresh()
    expect(injected.controller.store.getSnapshot()).toMatchObject({ status: 'error', error: 'offline' })
    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toEqual([])
    expect(() => b.locale.register('settings.tokenUsage', 'zh', {})).not.toThrow()
  })
})
