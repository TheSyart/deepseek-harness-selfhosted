import { describe, expect, it } from 'vitest'
import { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import type { TokenUsageTimelineState } from '@deepseek-ai/dsh-token-meter'
import { aggregateTokenUsage } from '../src/report.ts'

const ZERO_STEP = null

function header(id: string, seedLength?: number): SessionHeader {
  return {
    version: 0,
    id: SessionId(id),
    createdAt: 0,
    ...seedLength === undefined ? {} : { seedLength },
  }
}

function timeline(samples: NonNullable<TokenUsageTimelineState['head']>['samples']): TokenUsageTimelineState {
  return {
    route: { kind: 'unknown' },
    step: ZERO_STEP,
    head: samples.length === 0 ? null : { samples, previous: null },
  }
}

describe('aggregateTokenUsage', () => {
  it('uses the requested IANA day boundary, excludes fork seed copies, and keeps lifetime outside 365 days', () => {
    const result = aggregateTokenUsage({
      generatedAt: Date.UTC(2026, 2, 8, 12),
      timeZone: 'America/Los_Angeles',
      sessions: [
        {
          header: header('root'),
          timeline: timeline([
            {
              seq: 1,
              time: Date.UTC(2026, 2, 8, 7, 30),
              turn: 1,
              step: 1,
              route: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
              buckets: { uncachedInputTokens: 10, cacheReadTokens: 3, cacheWriteTokens: 2, outputTokens: 4 },
            },
            {
              seq: 2,
              time: Date.UTC(2026, 2, 8, 8, 30),
              turn: 2,
              step: 1,
              route: { kind: 'model', provider: 'openai', model: 'gpt-5.6' },
              buckets: { uncachedInputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 0, outputTokens: 7 },
            },
            {
              seq: 3,
              time: Date.UTC(2024, 0, 1),
              turn: 3,
              step: 1,
              route: { kind: 'unknown' },
              buckets: { uncachedInputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10 },
            },
          ]),
        },
        {
          header: header('fork', 2),
          timeline: timeline([
            {
              seq: 1,
              time: Date.UTC(2026, 2, 8, 7, 30),
              turn: 1,
              step: 1,
              route: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
              buckets: { uncachedInputTokens: 10, cacheReadTokens: 3, cacheWriteTokens: 2, outputTokens: 4 },
            },
            {
              seq: 2,
              time: Date.UTC(2026, 2, 8, 9, 30),
              turn: 2,
              step: 1,
              route: { kind: 'model', provider: 'anthropic', model: 'claude-sonnet' },
              buckets: { uncachedInputTokens: 8, cacheReadTokens: 1, cacheWriteTokens: 0, outputTokens: 6 },
            },
          ]),
        },
      ],
      failedSessionCount: 1,
    })

    expect(result.window).toEqual({ from: '2025-03-09', through: '2026-03-08', days: 365 })
    expect(result.lifetime).toEqual({
      uncachedInputTokens: 138,
      cacheReadTokens: 9,
      cacheWriteTokens: 2,
      outputTokens: 27,
    })
    expect(result.coverage).toEqual({ sessionCount: 2, failedSessionCount: 1 })
    expect(result.days).toEqual([
      {
        date: '2026-03-07',
        buckets: { uncachedInputTokens: 10, cacheReadTokens: 3, cacheWriteTokens: 2, outputTokens: 4 },
        routes: [{
          route: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
          buckets: { uncachedInputTokens: 10, cacheReadTokens: 3, cacheWriteTokens: 2, outputTokens: 4 },
        }],
      },
      {
        date: '2026-03-08',
        buckets: { uncachedInputTokens: 28, cacheReadTokens: 6, cacheWriteTokens: 0, outputTokens: 13 },
        routes: [
          {
            route: { kind: 'model', provider: 'anthropic', model: 'claude-sonnet' },
            buckets: { uncachedInputTokens: 8, cacheReadTokens: 1, cacheWriteTokens: 0, outputTokens: 6 },
          },
          {
            route: { kind: 'model', provider: 'openai', model: 'gpt-5.6' },
            buckets: { uncachedInputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 0, outputTokens: 7 },
          },
        ],
      },
    ])
  })

  it('rejects invalid time zones and unsafe bucket totals', () => {
    const input = {
      generatedAt: 0,
      sessions: [{
        header: header('overflow'),
        timeline: timeline([
          {
            seq: 0,
            time: 0,
            turn: 1,
            step: 1,
            route: { kind: 'unknown' as const },
            buckets: { uncachedInputTokens: Number.MAX_SAFE_INTEGER, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
          },
          {
            seq: 1,
            time: 1,
            turn: 2,
            step: 1,
            route: { kind: 'unknown' as const },
            buckets: { uncachedInputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
          },
        ]),
      }],
      failedSessionCount: 0,
    }

    expect(() => aggregateTokenUsage({ ...input, timeZone: 'Not/A_Time_Zone' }))
      .toThrow('invalid IANA time zone')
    expect(() => aggregateTokenUsage({ ...input, timeZone: 'UTC' }))
      .toThrow('safe integer')
  })

  it('rejects a combined total that exceeds the safe integer range', () => {
    expect(() => aggregateTokenUsage({
      generatedAt: 0,
      timeZone: 'UTC',
      sessions: [{
        header: header('cross-bucket-overflow'),
        timeline: timeline([{
          seq: 0,
          time: 0,
          turn: 1,
          step: 1,
          route: { kind: 'unknown' },
          buckets: {
            uncachedInputTokens: Number.MAX_SAFE_INTEGER,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 1,
          },
        }]),
      }],
      failedSessionCount: 0,
    })).toThrow('safe integer')
  })
})
