import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter, { type TokenUsageTimelineState } from '@deepseek-ai/dsh-token-meter'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import TokenUsageReportService from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function header(id: string): SessionHeader {
  return { version: 0, id: SessionId(id), createdAt: 0 }
}

function timeline(inputTokens: number, provider = 'cold', model = 'model'): TokenUsageTimelineState {
  return {
    route: { kind: 'model', provider, model },
    step: null,
    head: {
      samples: [{
        seq: 0,
        time: 0,
        turn: 1,
        step: 1,
        route: { kind: 'model', provider, model },
        buckets: {
          uncachedInputTokens: inputTokens,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 1,
        },
      }],
      previous: null,
    },
  }
}

interface HarnessOptions {
  snapshots: Array<{ header: SessionHeader; revision: ReturnType<typeof SessionPersistenceRevision> }>
  coldState: (id: SessionId, key: 'tokenUsageTimeline', signal?: AbortSignal) => Promise<TokenUsageTimelineState | undefined>
  readConcurrency?: number
}

async function harness(options: HarnessOptions) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(TokenMeter)
  const listSnapshots = vi.fn(async (_signal?: AbortSignal) => options.snapshots)
  const coldState = vi.fn(options.coldState)
  ctx.provide('sessionPersistence', { listSnapshots } as never)
  ctx.provide('sessionProjectionCache', { coldState } as never)
  await ctx.plugin(TokenUsageReportService, { readConcurrency: options.readConcurrency ?? 2 })
  return {
    ctx,
    report: ctx.get('tokenUsageReport') as TokenUsageReportService,
    listSnapshots,
    coldState,
  }
}

describe('TokenUsageReportService', () => {
  it('uses live timelines over same-id cold state and revision-caches unchanged cold sessions', async () => {
    const snapshots = [
      { header: header('cold'), revision: SessionPersistenceRevision('r1') },
      { header: header('live'), revision: SessionPersistenceRevision('r-live') },
      { header: header('bad'), revision: SessionPersistenceRevision('r-bad') },
    ]
    const mounted = await harness({
      snapshots,
      coldState: async id => {
        if (id === SessionId('bad')) throw new Error('broken log')
        return timeline(10)
      },
    })
    const live = mounted.ctx.sessions.create(SessionId('live'))
    live.append('request/header', {
      header: { config: { provider: 'live-provider', model: 'live-model' } },
      reason: 'initial',
    })
    live.append('step/start', { turn: 1, step: 1 })
    live.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'usage', usage: { inputTokens: 4, outputTokens: 2 } },
    })

    const first = await mounted.report.snapshot({ timeZone: 'UTC' })
    expect(first.lifetime).toEqual({
      uncachedInputTokens: 14,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 3,
    })
    expect(first.coverage).toEqual({ sessionCount: 2, failedSessionCount: 1 })
    expect(mounted.coldState.mock.calls.map(call => call[0])).toEqual([
      SessionId('cold'),
      SessionId('bad'),
    ])

    await mounted.report.snapshot({ timeZone: 'UTC' })
    expect(mounted.coldState.mock.calls.map(call => call[0])).toEqual([
      SessionId('cold'),
      SessionId('bad'),
      SessionId('bad'),
    ])

    snapshots[0] = { header: header('cold'), revision: SessionPersistenceRevision('r2') }
    await mounted.report.snapshot({ timeZone: 'UTC' })
    expect(mounted.coldState.mock.calls.filter(call => call[0] === SessionId('cold'))).toHaveLength(2)
  })

  it('bounds cold reads by the required concurrency config', async () => {
    let active = 0
    let maximum = 0
    const mounted = await harness({
      snapshots: Array.from({ length: 6 }, (_, index) => ({
        header: header(`cold-${index}`),
        revision: SessionPersistenceRevision(`r-${index}`),
      })),
      readConcurrency: 2,
      coldState: async () => {
        active += 1
        maximum = Math.max(maximum, active)
        await Promise.resolve()
        active -= 1
        return timeline(1)
      },
    })

    await expect(mounted.report.snapshot({ timeZone: 'UTC' }))
      .resolves.toMatchObject({ coverage: { sessionCount: 6, failedSessionCount: 0 } })
    expect(maximum).toBe(2)
  })

  it('publishes one cancellable snapshot Remote and propagates listing failures', async () => {
    const mounted = await harness({ snapshots: [], coldState: async () => timeline(1) })
    expect(mounted.report.typertRemote).toMatchObject({
      serviceKey: 'tokenUsageReport',
      namespace: 'tokenUsageReport',
    })
    expect(remoteMethods(mounted.report)).toEqual([
      { method: 'snapshot', invocation: { kind: 'direct' } },
    ])

    const controller = new AbortController()
    await mounted.report.snapshot({ timeZone: 'UTC' }, controller.signal)
    expect(mounted.listSnapshots).toHaveBeenCalledWith(controller.signal)

    const failure = new Error('list unavailable')
    mounted.listSnapshots.mockRejectedValueOnce(failure)
    await expect(mounted.report.snapshot({ timeZone: 'UTC' })).rejects.toBe(failure)

    mounted.listSnapshots.mockClear()
    await expect(mounted.report.snapshot({ timeZone: 'Mars/Olympus_Mons' }))
      .rejects.toThrow('invalid IANA time zone')
    expect(mounted.listSnapshots).not.toHaveBeenCalled()
  })

  it('rejects a globally missing timeline projection instead of reporting partial coverage', async () => {
    const mounted = await harness({
      snapshots: [{ header: header('missing-projection'), revision: SessionPersistenceRevision('r1') }],
      coldState: async () => undefined,
    })

    await expect(mounted.report.snapshot({ timeZone: 'UTC' }))
      .rejects.toThrow('tokenUsageTimeline projection is not registered')
  })
})
