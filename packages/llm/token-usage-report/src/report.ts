import type { SessionHeader } from '@deepseek-ai/dsh-session'
import type {
  TokenUsageTimelineBuckets,
  TokenUsageTimelineRoute,
  TokenUsageTimelineState,
} from '@deepseek-ai/dsh-token-meter'
import { tokenUsageTimelineSamples } from '@deepseek-ai/dsh-token-meter'
import type {
  TokenUsageBuckets,
  TokenUsageDay,
  TokenUsageReportSnapshot,
  TokenUsageRoute,
} from './types.ts'

/** Inputs already resolved to one timeline per persisted or live session. */
export interface TokenUsageAggregationInput {
  readonly generatedAt: number
  readonly timeZone: string
  readonly sessions: readonly {
    readonly header: SessionHeader
    readonly timeline: TokenUsageTimelineState
  }[]
  readonly failedSessionCount: number
}

const zeroBuckets = (): TokenUsageBuckets => ({
  uncachedInputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
})

/** Add one non-negative safe-integer bucket value without losing precision. */
function safeAdd(left: number, right: number, bucket: keyof TokenUsageBuckets): number {
  if (!Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0) {
    throw new RangeError(`token usage ${bucket} must be a non-negative safe integer`)
  }
  const total = left + right
  if (!Number.isSafeInteger(total)) {
    throw new RangeError(`token usage ${bucket} total exceeds the safe integer range`)
  }
  return total
}

function addBuckets(
  target: TokenUsageBuckets,
  source: TokenUsageTimelineBuckets,
): TokenUsageBuckets {
  return {
    uncachedInputTokens: safeAdd(target.uncachedInputTokens, source.uncachedInputTokens, 'uncachedInputTokens'),
    cacheReadTokens: safeAdd(target.cacheReadTokens, source.cacheReadTokens, 'cacheReadTokens'),
    cacheWriteTokens: safeAdd(target.cacheWriteTokens, source.cacheWriteTokens, 'cacheWriteTokens'),
    outputTokens: safeAdd(target.outputTokens, source.outputTokens, 'outputTokens'),
  }
}

function routeKey(route: TokenUsageTimelineRoute): string {
  return route.kind === 'unknown' ? '["unknown"]' : JSON.stringify(['model', route.provider, route.model])
}

function publicRoute(route: TokenUsageTimelineRoute): TokenUsageRoute {
  return route.kind === 'unknown'
    ? { kind: 'unknown' }
    : { kind: 'model', provider: route.provider, model: route.model }
}

function compareRoutes(left: TokenUsageRoute, right: TokenUsageRoute): number {
  if (left.kind !== right.kind) return left.kind === 'model' ? -1 : 1
  if (left.kind === 'unknown' || right.kind === 'unknown') return 0
  const provider = left.provider < right.provider ? -1 : left.provider > right.provider ? 1 : 0
  if (provider !== 0) return provider
  return left.model < right.model ? -1 : left.model > right.model ? 1 : 0
}

/** Build a stable `YYYY-MM-DD` formatter and reject unknown IANA zones. */
function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en', {
      timeZone,
      calendar: 'gregory',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  } catch (error) {
    if (error instanceof RangeError) throw new RangeError(`invalid IANA time zone "${timeZone}"`)
    throw error
  }
}

/**
 * Reject a non-IANA time-zone identifier before report I/O begins.
 * @param timeZone - browser time-zone identifier.
 */
export function validateTokenUsageTimeZone(timeZone: string): void {
  dayFormatter(timeZone)
}

function formatDay(formatter: Intl.DateTimeFormat, timestamp: number): string {
  const parts = formatter.formatToParts(timestamp)
  const year = parts.find(part => part.type === 'year')?.value
  const month = parts.find(part => part.type === 'month')?.value
  const day = parts.find(part => part.type === 'day')?.value
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error('IANA date formatter did not return Gregorian date parts')
  }
  return `${year}-${month}-${day}`
}

function shiftDay(date: string, offset: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + offset))
  return `${shifted.getUTCFullYear().toString().padStart(4, '0')}-${(shifted.getUTCMonth() + 1).toString().padStart(2, '0')}-${shifted.getUTCDate().toString().padStart(2, '0')}`
}

function bucketTotal(buckets: TokenUsageBuckets): number {
  let result = 0
  result = safeAdd(result, buckets.uncachedInputTokens, 'uncachedInputTokens')
  result = safeAdd(result, buckets.cacheReadTokens, 'cacheReadTokens')
  result = safeAdd(result, buckets.cacheWriteTokens, 'cacheWriteTokens')
  return safeAdd(result, buckets.outputTokens, 'outputTokens')
}

interface MutableDay {
  buckets: TokenUsageBuckets
  routes: Map<string, { route: TokenUsageRoute; buckets: TokenUsageBuckets }>
}

/**
 * Aggregate resolved session timelines into the public report.
 *
 * @param input Resolved timelines, requested time zone, and generation time.
 * @returns The global lifetime and rolling-window usage report.
 */
export function aggregateTokenUsage(input: TokenUsageAggregationInput): TokenUsageReportSnapshot {
  const formatter = dayFormatter(input.timeZone)
  const through = formatDay(formatter, input.generatedAt)
  const from = shiftDay(through, -364)
  let lifetime = zeroBuckets()
  const days = new Map<string, MutableDay>()

  for (const session of input.sessions) {
    const seedLength = session.header.seedLength ?? 0
    for (const sample of tokenUsageTimelineSamples(session.timeline)) {
      if (sample.seq < seedLength) continue
      lifetime = addBuckets(lifetime, sample.buckets)
      const date = formatDay(formatter, sample.time)
      if (date < from || date > through) continue
      const day = days.get(date) ?? { buckets: zeroBuckets(), routes: new Map() }
      day.buckets = addBuckets(day.buckets, sample.buckets)
      const key = routeKey(sample.route)
      const route = day.routes.get(key) ?? { route: publicRoute(sample.route), buckets: zeroBuckets() }
      route.buckets = addBuckets(route.buckets, sample.buckets)
      day.routes.set(key, route)
      days.set(date, day)
    }
  }

  const reportedDays: TokenUsageDay[] = [...days.entries()]
    .filter(([, day]) => bucketTotal(day.buckets) > 0)
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([date, day]) => ({
      date,
      buckets: day.buckets,
      routes: [...day.routes.values()]
        .filter(route => bucketTotal(route.buckets) > 0)
        .sort((left, right) => compareRoutes(left.route, right.route)),
    }))

  bucketTotal(lifetime)

  return {
    generatedAt: input.generatedAt,
    timeZone: input.timeZone,
    window: { from, through, days: 365 },
    lifetime,
    coverage: {
      sessionCount: input.sessions.length,
      failedSessionCount: input.failedSessionCount,
    },
    days: reportedDays,
  }
}
