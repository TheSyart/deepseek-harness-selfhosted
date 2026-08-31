import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as TokenUsageReportInvariant from '@deepseek-ai/dsh-token-usage-report/invariant'

describe('invariant companion', () => {
  it('reserves package ownership with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(TokenUsageReportInvariant).await()).resolves.toBeDefined()
  })
})
