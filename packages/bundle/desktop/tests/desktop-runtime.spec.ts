/**
 * Desktop runtime glue: the webServer composition facade (loopback host,
 * portless fail-loud, no-op route seats, ordered index taps) and the
 * desktop-surface prompt section assembly.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { apply, Config, DesktopWebServerFacade } from '../src/index.ts'

describe('DesktopWebServerFacade', () => {
  it('reports the loopback bind and fails loud on a port read', () => {
    const facade = new DesktopWebServerFacade()
    expect(facade.host).toBe('127.0.0.1')
    expect(() => facade.port).toThrow(/no HTTP/)
  })

  it('accepts route and upgrade registrations as no-op seats', () => {
    const facade = new DesktopWebServerFacade()
    const stopRoute = facade.register({ kind: 'prefix', path: '/api', handler: async () => {} })
    const stopUpgrade = facade.registerUpgrade({ path: '/api/events.mux', handler: () => {} })
    expect(() => { stopRoute(); stopUpgrade() }).not.toThrow()
  })

  it('refuses the HTTP fallback seat', () => {
    const facade = new DesktopWebServerFacade()
    expect(() => facade.registerFallback(async () => {})).toThrow(/no fallback seat/)
  })

  it('applies index taps in registration order and removes them on disposal', () => {
    const facade = new DesktopWebServerFacade()
    expect(facade.applyIndexTaps('plain')).toBe('plain')
    const order: string[] = []
    const stopFirst = facade.tapIndex((html) => {
      order.push('first')
      return `${html}-first`
    })
    facade.tapIndex((html) => {
      order.push('second')
      return `${html}-second`
    })
    expect(facade.applyIndexTaps('html')).toBe('html-first-second')
    expect(order).toEqual(['first', 'second'])
    stopFirst()
    // A second disposal of the same tap is a no-op.
    stopFirst()
    expect(facade.applyIndexTaps('html')).toBe('html-second')
  })
})

describe('desktop-runtime apply', () => {
  let ctx: Context | undefined

  afterEach(async () => {
    await ctx?.fiber.dispose()
    ctx = undefined
  })

  it('provides the webServer facade and the desktop surface prompt section', async () => {
    ctx = new Context()
    apply(ctx, new Config({ surfaceContext: true }))
    expect(ctx.get('webServer')).toBeInstanceOf(DesktopWebServerFacade)
    await ctx.plugin(SystemPrompt, { persona: '' })
    // Settle the injected prompt-section registration.
    await new Promise(resolve => setTimeout(resolve, 0))
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(entry => entry.name === 'harness:source')?.text)
      .toContain('DeepSeek Harness implementation checkout')
    const section = assembly.sections.find(entry => entry.name === 'app:desktop-surface')
    expect(section?.text).toContain('desktop app (Electron)')
    expect(section?.text).toContain('in-process IPC bridge')
  })

  it('omits the surface prompt when surfaceContext is off', async () => {
    ctx = new Context()
    apply(ctx, new Config({ surfaceContext: false }))
    await ctx.plugin(SystemPrompt, { persona: '' })
    await new Promise(resolve => setTimeout(resolve, 0))
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(entry => entry.name === 'app:desktop-surface')).toBeUndefined()
  })
})
