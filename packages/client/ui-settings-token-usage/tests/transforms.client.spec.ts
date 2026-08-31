import { describe, expect, it } from 'vitest'
import type {
  TokenUsageBuckets,
  TokenUsageReportSnapshot,
  TokenUsageRoute,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  buildCumulativeHeatmap,
  buildHeatmap,
  buildModelTrend,
  buildTypeTrend,
  buildWeeklyHeatmap,
  deriveLifetimeMetrics,
  rankRoutes,
  routeIdentity,
} from '../src/client/transforms.ts'

const zero = (): TokenUsageBuckets => ({
  uncachedInputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
})

const model = (provider: string, name: string): TokenUsageRoute => ({
  kind: 'model', provider, model: name,
})

function snapshot(routes: Array<{ route: TokenUsageRoute; buckets: TokenUsageBuckets }>): TokenUsageReportSnapshot {
  const dayBuckets = routes.reduce<TokenUsageBuckets>((sum, item) => ({
    uncachedInputTokens: sum.uncachedInputTokens + item.buckets.uncachedInputTokens,
    cacheReadTokens: sum.cacheReadTokens + item.buckets.cacheReadTokens,
    cacheWriteTokens: sum.cacheWriteTokens + item.buckets.cacheWriteTokens,
    outputTokens: sum.outputTokens + item.buckets.outputTokens,
  }), zero())
  return {
    generatedAt: 0,
    timeZone: 'UTC',
    window: { from: '2025-01-01', through: '2025-12-31', days: 365 },
    lifetime: dayBuckets,
    coverage: { sessionCount: 1, failedSessionCount: 0 },
    days: [{ date: '2025-12-31', buckets: dayBuckets, routes }],
  }
}

describe('token usage transforms', () => {
  it('derives lifetime total, input, output, and cache hit without double-counting output', () => {
    expect(deriveLifetimeMetrics({
      uncachedInputTokens: 100,
      cacheReadTokens: 50,
      cacheWriteTokens: 25,
      outputTokens: 40,
    })).toEqual({ totalTokens: 215, inputTokens: 175, outputTokens: 40, cacheHitRate: 50 / 175 })
    expect(deriveLifetimeMetrics(zero()).cacheHitRate).toBeNull()
  })

  it('ranks every exact route by period total with deterministic provider/model ties', () => {
    const report = snapshot([
      { route: model('zeta', 'same'), buckets: { ...zero(), uncachedInputTokens: 10 } },
      { route: model('alpha', 'same'), buckets: { ...zero(), outputTokens: 10 } },
      { route: { kind: 'unknown' }, buckets: { ...zero(), outputTokens: 4 } },
    ])

    expect(rankRoutes(report, 30).map(row => ({ id: row.id, total: row.totalTokens }))).toEqual([
      { id: '["model","alpha","same"]', total: 10 },
      { id: '["model","zeta","same"]', total: 10 },
      { id: 'unknown', total: 4 },
    ])
  })

  it('keeps routes with slashes collision-free while retaining readable labels', () => {
    const report = snapshot([
      { route: model('a/b', 'c'), buckets: { ...zero(), uncachedInputTokens: 8 } },
      { route: model('a', 'b/c'), buckets: { ...zero(), outputTokens: 7 } },
    ])

    const ranking = rankRoutes(report, 30)
    expect(new Set(ranking.map(row => row.id)).size).toBe(2)
    expect(buildModelTrend(report, 30).series.map(series => series.label))
      .toEqual(['a/b · c', 'a · b/c'])
  })

  it('shows the Top 5 exact routes and merges the remainder into Other', () => {
    const routes = Array.from({ length: 7 }, (_, index) => ({
      route: model(`provider-${index}`, `model-${index}`),
      buckets: { ...zero(), uncachedInputTokens: 70 - index * 10, outputTokens: index },
    }))
    const trend = buildModelTrend(snapshot(routes), 30)

    expect(trend.dates).toHaveLength(30)
    expect(trend.dates.at(-1)).toBe('2025-12-31')
    expect(trend.series.map(series => series.id)).toEqual([
      '["model","provider-0","model-0"]',
      '["model","provider-1","model-1"]',
      '["model","provider-2","model-2"]',
      '["model","provider-3","model-3"]',
      '["model","provider-4","model-4"]',
      'other',
    ])
    expect(trend.series.at(-1)?.values.at(-1)).toBe(41)
    expect(trend.series.slice(0, 5).map(series => series.visual)).toEqual(
      trend.series.slice(0, 5).map(series => routeIdentity(series.route)),
    )
  })

  it('builds the fixed four disjoint type lines and five non-zero heat levels', () => {
    const report: TokenUsageReportSnapshot = {
      ...snapshot([]),
      lifetime: { uncachedInputTokens: 15, cacheReadTokens: 10, cacheWriteTokens: 5, outputTokens: 20 },
      days: [1, 2, 3, 4, 5].map((value, index) => ({
        date: `2025-12-${String(27 + index).padStart(2, '0')}`,
        buckets: { uncachedInputTokens: value, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
        routes: [],
      })),
    }

    const trend = buildTypeTrend(report, 30)
    expect(trend.series.map(series => series.id)).toEqual([
      'uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens',
    ])
    expect(trend.series[0]?.values.slice(-5)).toEqual([1, 2, 3, 4, 5])
    expect(buildHeatmap(report).filter(cell => cell.level > 0).map(cell => cell.level))
      .toEqual([1, 2, 3, 4, 5])
  })

  it('aggregates Monday-through-Sunday weeks and retains both partial edge weeks', () => {
    const report: TokenUsageReportSnapshot = {
      ...snapshot([]),
      window: { from: '2025-01-01', through: '2025-12-31', days: 365 },
      days: [
        {
          date: '2025-01-01',
          buckets: { ...zero(), uncachedInputTokens: 2 },
          routes: [],
        },
        {
          date: '2025-01-05',
          buckets: { ...zero(), outputTokens: 3 },
          routes: [],
        },
        {
          date: '2025-12-31',
          buckets: { ...zero(), outputTokens: 7 },
          routes: [],
        },
      ],
    }

    const weeks = buildWeeklyHeatmap(report)
    expect(weeks).toHaveLength(53)
    expect(weeks[0]).toMatchObject({
      from: '2025-01-01', through: '2025-01-05', totalTokens: 5,
    })
    expect(weeks.at(-1)).toMatchObject({
      from: '2025-12-29', through: '2025-12-31', totalTokens: 7,
    })
  })

  it('builds a monotonic cumulative calendar and rejects unsafe sums', () => {
    const report: TokenUsageReportSnapshot = {
      ...snapshot([]),
      days: [
        {
          date: '2025-12-30',
          buckets: { ...zero(), uncachedInputTokens: 3 },
          routes: [],
        },
        {
          date: '2025-12-31',
          buckets: { ...zero(), outputTokens: 4 },
          routes: [],
        },
      ],
    }
    expect(buildCumulativeHeatmap(report).slice(-2).map(cell => cell.totalTokens)).toEqual([3, 7])

    const unsafe: TokenUsageReportSnapshot = {
      ...report,
      days: [
        {
          date: '2025-12-30',
          buckets: { ...zero(), uncachedInputTokens: Number.MAX_SAFE_INTEGER },
          routes: [],
        },
        {
          date: '2025-12-31',
          buckets: { ...zero(), outputTokens: 1 },
          routes: [],
        },
      ],
    }
    expect(() => buildCumulativeHeatmap(unsafe)).toThrow(/safe integer/)
  })
})
