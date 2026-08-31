import type {
  TokenUsageBuckets,
  TokenUsageReportSnapshot,
  TokenUsageRoute,
} from '@deepseek-ai/dsh-api-remotes/client'

/** User-selectable trend and ranking window in days. */
export type UsagePeriod = 30 | 90 | 365

/** Values displayed by the lifetime summary cards. */
export interface LifetimeMetrics {
  readonly totalTokens: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheHitRate: number | null
}

/** One exact route and its contribution within the selected period. */
export interface RouteRanking {
  readonly id: string
  readonly route: TokenUsageRoute
  readonly buckets: TokenUsageBuckets
  readonly totalTokens: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly share: number
}

/** One independently toggleable line in the trend chart. */
export interface TrendSeries {
  readonly id: string
  readonly label: string
  readonly route: TokenUsageRoute | undefined
  readonly visual: string
  readonly values: readonly number[]
}

/** Dates and series rendered by the trend chart. */
export interface TrendData {
  readonly dates: readonly string[]
  readonly series: readonly TrendSeries[]
}

/** One calendar cell in the rolling activity heatmap. */
export interface HeatmapCell {
  readonly date: string
  readonly totalTokens: number
  readonly level: 0 | 1 | 2 | 3 | 4 | 5
}

/** One Monday-through-Sunday bucket clipped to the report window. */
export interface WeeklyHeatmapCell {
  readonly from: string
  readonly through: string
  readonly totalTokens: number
  readonly level: 0 | 1 | 2 | 3 | 4 | 5
}

const zeroBuckets = (): TokenUsageBuckets => ({
  uncachedInputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
})

function addBuckets(left: TokenUsageBuckets, right: TokenUsageBuckets): TokenUsageBuckets {
  return {
    uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    outputTokens: left.outputTokens + right.outputTokens,
  }
}

function total(buckets: TokenUsageBuckets): number {
  return buckets.uncachedInputTokens
    + buckets.cacheReadTokens
    + buckets.cacheWriteTokens
    + buckets.outputTokens
}

function inputTotal(buckets: TokenUsageBuckets): number {
  return buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
}

function routeKey(route: TokenUsageRoute): string {
  return route.kind === 'unknown' ? '["unknown"]' : JSON.stringify(['model', route.provider, route.model])
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareRoute(left: TokenUsageRoute, right: TokenUsageRoute): number {
  if (left.kind !== right.kind) return left.kind === 'model' ? -1 : 1
  if (left.kind === 'unknown' || right.kind === 'unknown') return 0
  return compareText(left.provider, right.provider) || compareText(left.model, right.model)
}

function shiftDate(date: string, offset: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + offset))
  return `${shifted.getUTCFullYear().toString().padStart(4, '0')}-${(shifted.getUTCMonth() + 1).toString().padStart(2, '0')}-${shifted.getUTCDate().toString().padStart(2, '0')}`
}

function dayOfWeek(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).getUTCDay()
}

function checkedAdd(left: number, right: number): number {
  const value = left + right
  if (!Number.isSafeInteger(value)) {
    throw new RangeError('Token usage sum exceeds the safe integer range')
  }
  return value
}

function quantileLevel(totalTokens: number, nonzero: readonly number[]): HeatmapCell['level'] {
  if (totalTokens === 0) return 0
  let rank = 0
  while ((nonzero[rank] ?? Number.POSITIVE_INFINITY) <= totalTokens) rank += 1
  return Math.max(1, Math.min(5, Math.ceil(rank * 5 / nonzero.length))) as 1 | 2 | 3 | 4 | 5
}

function periodDates(snapshot: TokenUsageReportSnapshot, period: UsagePeriod): string[] {
  return Array.from({ length: period }, (_, index) => shiftDate(snapshot.window.through, index - period + 1))
}

/**
 * Return the stable identity used for one route across refreshes and periods.
 *
 * @param route Exact model route, or undefined for the aggregated remainder.
 * @returns A stable string identity.
 */
export function routeIdentity(route: TokenUsageRoute | undefined): string {
  if (route === undefined) return 'other'
  return route.kind === 'unknown'
    ? 'unknown'
    : JSON.stringify(['model', route.provider, route.model])
}

function routeDisplay(route: TokenUsageRoute): string {
  return route.kind === 'unknown' ? 'unknown' : `${route.provider} · ${route.model}`
}

/**
 * Derive the lifetime card metrics from provider-reported buckets.
 *
 * @param buckets Lifetime token buckets.
 * @returns Total, input, output, and optional cache-hit values.
 */
export function deriveLifetimeMetrics(buckets: TokenUsageBuckets): LifetimeMetrics {
  const inputTokens = inputTotal(buckets)
  return {
    totalTokens: total(buckets),
    inputTokens,
    outputTokens: buckets.outputTokens,
    cacheHitRate: inputTokens === 0 ? null : buckets.cacheReadTokens / inputTokens,
  }
}

/**
 * Rank every exact route represented in the selected date window.
 *
 * @param snapshot Global usage snapshot.
 * @param period Number of trailing calendar days to include.
 * @returns Routes sorted by descending total usage with stable tie-breaking.
 */
export function rankRoutes(snapshot: TokenUsageReportSnapshot, period: UsagePeriod): RouteRanking[] {
  const from = shiftDate(snapshot.window.through, 1 - period)
  const routes = new Map<string, { route: TokenUsageRoute; buckets: TokenUsageBuckets }>()
  for (const day of snapshot.days) {
    if (day.date < from || day.date > snapshot.window.through) continue
    for (const item of day.routes) {
      const key = routeKey(item.route)
      const current = routes.get(key)
      routes.set(key, {
        route: item.route,
        buckets: addBuckets(current?.buckets ?? zeroBuckets(), item.buckets),
      })
    }
  }
  const periodTotal = [...routes.values()].reduce((sum, item) => sum + total(item.buckets), 0)
  return [...routes.values()]
    .map(({ route, buckets }) => ({
      id: routeIdentity(route),
      route,
      buckets,
      totalTokens: total(buckets),
      inputTokens: inputTotal(buckets),
      outputTokens: buckets.outputTokens,
      share: periodTotal === 0 ? 0 : total(buckets) / periodTotal,
    }))
    .sort((left, right) => right.totalTokens - left.totalTokens || compareRoute(left.route, right.route))
}

/**
 * Build the Top 5 exact-route series and aggregate remaining routes as Other.
 *
 * @param snapshot Global usage snapshot.
 * @param period Number of trailing calendar days to include.
 * @returns Dense daily model trend data.
 */
export function buildModelTrend(snapshot: TokenUsageReportSnapshot, period: UsagePeriod): TrendData {
  const dates = periodDates(snapshot, period)
  const top = rankRoutes(snapshot, period).slice(0, 5)
  const topKeys = new Map(top.map((row, index) => [routeKey(row.route), index]))
  const values = top.map(() => Array.from({ length: dates.length }, () => 0))
  const other = Array.from({ length: dates.length }, () => 0)
  const dateIndexes = new Map(dates.map((date, index) => [date, index]))
  for (const day of snapshot.days) {
    const dateIndex = dateIndexes.get(day.date)
    if (dateIndex === undefined) continue
    for (const item of day.routes) {
      const seriesIndex = topKeys.get(routeKey(item.route))
      if (seriesIndex === undefined) {
        other[dateIndex] = (other[dateIndex] ?? 0) + total(item.buckets)
      } else {
        const series = values[seriesIndex]
        /* v8 ignore next -- topKeys and values are constructed from the same ranked rows. */
        if (series !== undefined) series[dateIndex] = total(item.buckets)
      }
    }
  }
  const series: TrendSeries[] = top.map((row, index) => ({
    id: row.id,
    label: routeDisplay(row.route),
    route: row.route,
    visual: routeIdentity(row.route),
    values: values[index] ?? [],
  }))
  if (other.some(value => value > 0)) {
    series.push({ id: 'other', label: 'other', route: undefined, visual: 'other', values: other })
  }
  return { dates, series }
}

/**
 * Build the four fixed provider-reported bucket series.
 *
 * @param snapshot Global usage snapshot.
 * @param period Number of trailing calendar days to include.
 * @returns Dense daily bucket trend data.
 */
export function buildTypeTrend(snapshot: TokenUsageReportSnapshot, period: UsagePeriod): TrendData {
  const dates = periodDates(snapshot, period)
  const dateIndexes = new Map(dates.map((date, index) => [date, index]))
  const keys = [
    'uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens',
  ] as const satisfies readonly (keyof TokenUsageBuckets)[]
  const series = keys.map(key => ({
    id: key,
    label: key,
    route: undefined,
    visual: key,
    values: Array.from({ length: dates.length }, () => 0),
  }))
  for (const day of snapshot.days) {
    const index = dateIndexes.get(day.date)
    if (index === undefined) continue
    for (const item of series) item.values[index] = day.buckets[item.id as keyof TokenUsageBuckets]
  }
  return { dates, series }
}

/**
 * Build rolling heatmap cells with non-zero quantile intensity levels.
 *
 * @param snapshot Global usage snapshot.
 * @returns One cell for every day in the snapshot window.
 */
export function buildHeatmap(snapshot: TokenUsageReportSnapshot): HeatmapCell[] {
  const totals = new Map(snapshot.days.map(day => [day.date, total(day.buckets)]))
  const nonzero = [...totals.values()].filter(value => value > 0).sort((left, right) => left - right)
  return Array.from({ length: 365 }, (_, index) => {
    const date = shiftDate(snapshot.window.through, index - 364)
    const totalTokens = totals.get(date) ?? 0
    return { date, totalTokens, level: quantileLevel(totalTokens, nonzero) }
  })
}

/**
 * Aggregate the report window into Monday-through-Sunday activity buckets.
 *
 * @param snapshot Global usage snapshot.
 * @returns Chronological weeks with report-window edges retained as partial weeks.
 */
export function buildWeeklyHeatmap(snapshot: TokenUsageReportSnapshot): WeeklyHeatmapCell[] {
  const totals = new Map(snapshot.days.map(day => [day.date, total(day.buckets)]))
  const weeks: Array<Omit<WeeklyHeatmapCell, 'level'>> = []
  let cursor = snapshot.window.from
  while (cursor <= snapshot.window.through) {
    const daysSinceMonday = (dayOfWeek(cursor) + 6) % 7
    const naturalThrough = shiftDate(cursor, 6 - daysSinceMonday)
    const through = naturalThrough < snapshot.window.through ? naturalThrough : snapshot.window.through
    let totalTokens = 0
    for (let date = cursor; date <= through; date = shiftDate(date, 1)) {
      totalTokens = checkedAdd(totalTokens, totals.get(date) ?? 0)
    }
    weeks.push({ from: cursor, through, totalTokens })
    cursor = shiftDate(through, 1)
  }
  const nonzero = weeks.map(week => week.totalTokens).filter(value => value > 0).sort((left, right) => left - right)
  return weeks.map(week => ({ ...week, level: quantileLevel(week.totalTokens, nonzero) }))
}

/**
 * Build a running total from the first through the last day of the rolling report window.
 *
 * @param snapshot Global usage snapshot.
 * @returns One cumulative value for every day in the report window.
 */
export function buildCumulativeHeatmap(snapshot: TokenUsageReportSnapshot): HeatmapCell[] {
  const totals = new Map(snapshot.days.map(day => [day.date, total(day.buckets)]))
  let running = 0
  const cells = Array.from({ length: snapshot.window.days }, (_, index) => {
    const date = shiftDate(snapshot.window.from, index)
    running = checkedAdd(running, totals.get(date) ?? 0)
    return { date, totalTokens: running }
  })
  const nonzero = cells.map(cell => cell.totalTokens).filter(value => value > 0).sort((left, right) => left - right)
  return cells.map(cell => ({ ...cell, level: quantileLevel(cell.totalTokens, nonzero) }))
}
