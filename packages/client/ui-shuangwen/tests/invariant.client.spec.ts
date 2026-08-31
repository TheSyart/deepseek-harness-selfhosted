/**
 * The package's node half: an empty host body and an explained empty
 * invariant companion — the dock is presentation over existing session state
 * and produces no model-visible or durable fact of its own.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as ShuangwenInvariant from '@deepseek-ai/dsh-client-ui-shuangwen/invariant'

describe('invariant companion', () => {
  it('reserves package ownership with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(ShuangwenInvariant).await()).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })

  it('has an empty node half', async () => {
    const { apply } = await import('@deepseek-ai/dsh-client-ui-shuangwen')

    // The host body exists only so the plugin appears in the host cordis.yml;
    // every surface this package ships lives in the browser half.
    apply()

    expect(typeof apply).toBe('function')
  })
})
