/**
 * apply wiring on a real cordis Context + SlotRegistry: the `shuangwen`
 * dictionaries registered, the dock entry registered into the
 * conversation-declared input dock with zero business face, declaration-aware
 * activation, and fiber-teardown unregistration. Component behavior is
 * covered props-direct in dock.client.spec.tsx.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { ShuangwenDock } from '../src/client/ShuangwenDock.tsx'
import { apply, inject } from '../src/client/index.ts'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  // The dock hole exists only while its declaring entry is live.
  ctx.slots.register(
    { name: 'root', children: { 'conversation.input.dock': { kind: 'list', scope: 'session' } } } as never,
    () => null,
  )
  ctx.provide('locale', new LocaleRuntime(ctx))
  return ctx
}

describe('apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('waits until a live entry declares the dock hole', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.slots.entries('conversation.input.dock')).toHaveLength(0)
    ctx.slots.register(
      { name: 'root', children: { 'conversation.input.dock': { kind: 'list', scope: 'session' } } } as never,
      () => null,
    )
    await Promise.resolve()
    expect(ctx.slots.entries('conversation.input.dock')).toHaveLength(1)
    await fiber.dispose()
  })

  it('registers the dock entry: list cell, locale seat, no inject face', async () => {
    const ctx = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = ctx.slots.entries('conversation.input.dock')[0]!
    expect(entry.options.id).toBe('shuangwen')
    expect(entry.component).toBe(ShuangwenDock)
    // All data rides the framework hooks; copy rides the standard locale seat.
    expect(entry.inject).toBeUndefined()
    expect(entry.locale).toBe('shuangwen')
    await ctx.fiber.dispose()
  })

  it('teardown unregisters the slot entry', async () => {
    const ctx = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.slots.entries('conversation.input.dock')).toHaveLength(1)
    await fiber.dispose()
    expect(ctx.slots.entries('conversation.input.dock')).toHaveLength(0)
    await ctx.fiber.dispose()
  })
})
