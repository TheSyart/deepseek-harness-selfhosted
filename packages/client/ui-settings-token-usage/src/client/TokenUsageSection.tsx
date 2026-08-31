/** Global Token usage dashboard for the compact settings modal. */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { TokenUsageReportSnapshot, TokenUsageRoute } from '@deepseek-ai/dsh-api-remotes/client'
import type { TokenUsageReportController } from './controller.ts'
import { REFRESH_INTERVALS, type RefreshIntervalSeconds } from '../token-usage-settings.ts'
import type { TokenUsageKey } from './locales.ts'
import {
  buildCumulativeHeatmap,
  buildHeatmap,
  buildModelTrend,
  buildTypeTrend,
  buildWeeklyHeatmap,
  deriveLifetimeMetrics,
  rankRoutes,
  type HeatmapCell,
  type TrendData,
  type TrendSeries,
  type UsagePeriod,
  type WeeklyHeatmapCell,
} from './transforms.ts'
import css from './TokenUsageSection.module.css'

/** Slot-injected controller, store, and localized copy. */
export interface TokenUsageSectionInjected {
  /** Page report controller. */
  controller: TokenUsageReportController
  hooks: {
    /** Report state bound by the UI renderer as useSnapshot. */
    snapshot: TokenUsageReportController['store']
  }
  /** Section dictionary lookup. */
  t: (key: TokenUsageKey) => string
}

/** Props delivered by the settings section slot. */
export type TokenUsageSectionProps = Partial<InjectFace<TokenUsageSectionInjected>>

type Copy = TokenUsageSectionInjected['t']
type DashboardView = 'activity' | 'trend' | 'models'
type HeatmapMode = 'daily' | 'weekly' | 'cumulative'
type TrendMode = 'model' | 'type'

const PERIODS: readonly UsagePeriod[] = [30, 90, 365]
const SERIES_DASHES = ['', '8 4', '2 4', '11 4 2 4', '4 3', '12 3'] as const
const SERIES_POINTS = ['circle', 'square', 'diamond'] as const
const SERIES_COLORS = [
  'var(--token-route-1)',
  'var(--token-route-2)',
  'var(--token-route-3)',
  'var(--token-route-4)',
  'var(--token-route-5)',
  'var(--token-route-6)',
] as const

function replace(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (copy, [key, value]) => copy.replace(`{${key}}`, String(value)),
    template,
  )
}

function formatCount(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact', maximumFractionDigits: 1,
  }).format(value)
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'percent', maximumFractionDigits: 1,
  }).format(value)
}

interface RouteCopy {
  readonly primary: string
  readonly secondary: string
  readonly accessible: string
}

function routeCopy(route: TokenUsageRoute, t: Copy): RouteCopy {
  if (route.kind === 'unknown') {
    const unknown = t('unknownRoute')
    return { primary: unknown, secondary: '', accessible: unknown }
  }
  return {
    primary: route.model,
    secondary: route.provider,
    accessible: `${route.model}, ${route.provider}`,
  }
}

function periodCopy(period: UsagePeriod): TokenUsageKey {
  if (period === 30) return 'period30'
  if (period === 90) return 'period90'
  return 'period365'
}

function typeCopy(id: string): TokenUsageKey {
  if (id === 'uncachedInputTokens') return 'uncachedInput'
  if (id === 'cacheReadTokens') return 'cacheRead'
  if (id === 'cacheWriteTokens') return 'cacheWrite'
  return 'output'
}

function seriesLabel(series: TrendSeries, mode: TrendMode, t: Copy): string {
  if (mode === 'type') return t(typeCopy(series.id))
  if (series.id === 'other') return t('other')
  return series.route === undefined ? series.label : routeCopy(series.route, t).accessible
}

interface SeriesVisual {
  readonly color: string
  readonly dash: string
  readonly point: typeof SERIES_POINTS[number]
}

type VisualResolver = (series: TrendSeries) => SeriesVisual

function createVisualResolver(): VisualResolver {
  const registry = new Map<string, SeriesVisual>()
  return (series) => {
    const existing = registry.get(series.visual)
    if (existing !== undefined) return existing
    const index = registry.size
    const visual: SeriesVisual = {
      color: SERIES_COLORS[index % SERIES_COLORS.length] ?? SERIES_COLORS[0],
      dash: SERIES_DASHES[index % SERIES_DASHES.length] ?? '',
      point: SERIES_POINTS[index % SERIES_POINTS.length] ?? 'circle',
    }
    registry.set(series.visual, visual)
    return visual
  }
}

function linePath(values: readonly number[], max: number): string {
  if (values.length === 0) return ''
  return values.map((value, index) => {
    const x = values.length === 1 ? 8 : 8 + index * 524 / (values.length - 1)
    const y = 20 + 204 * (1 - value / max)
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
  }).join(' ')
}

function Point({ x, y, visual }: { x: number; y: number; visual: SeriesVisual }): ReactNode {
  if (visual.point === 'square') return <rect x={x - 3} y={y - 3} width="6" height="6" fill={visual.color} />
  if (visual.point === 'diamond') return <path d={`M${x} ${y - 4}L${x + 4} ${y}L${x} ${y + 4}L${x - 4} ${y}Z`} fill={visual.color} />
  return <circle cx={x} cy={y} r="3.5" fill={visual.color} />
}

function TrendChart({
  data,
  mode,
  t,
  resolveVisual,
}: {
  data: TrendData
  mode: TrendMode
  t: Copy
  resolveVisual: VisualResolver
}): ReactNode {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())
  const [focusIndex, setFocusIndex] = useState(data.dates.length - 1)
  const finalDate = data.dates.at(-1)
  useEffect(() => { setFocusIndex(data.dates.length - 1) }, [data.dates.length, finalDate])
  const visible = data.series.filter(series => !hidden.has(series.id))
  const max = Math.max(1, ...visible.flatMap(series => series.values))
  const focusedDate = data.dates[focusIndex] ?? finalDate ?? ''
  const focusedAria = [
    focusedDate,
    ...visible.map(series => `${seriesLabel(series, mode, t)}: ${formatCount(series.values[focusIndex] ?? 0)}`),
  ].join('; ')

  const toggle = (id: string): void => {
    setHidden(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>): void => {
    let next = focusIndex
    if (event.key === 'ArrowLeft') next -= 1
    else if (event.key === 'ArrowRight') next += 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = data.dates.length - 1
    else if (event.key === 'PageUp') next -= 7
    else if (event.key === 'PageDown') next += 7
    else return
    event.preventDefault()
    setFocusIndex(Math.max(0, Math.min(data.dates.length - 1, next)))
  }

  const focusX = data.dates.length <= 1 ? 8 : 8 + focusIndex * 524 / (data.dates.length - 1)
  return (
    <div className={css.trendChart} aria-label={t('trendAria')}>
      <div className={css.legend}>
        {data.series.map((series) => {
          const visual = resolveVisual(series)
          const label = seriesLabel(series, mode, t)
          const copy = series.route === undefined ? undefined : routeCopy(series.route, t)
          return (
            <button
              key={series.id}
              type="button"
              className={css.legendButton}
              aria-pressed={!hidden.has(series.id)}
              aria-label={label}
              title={label}
              onClick={() => { toggle(series.id) }}
            >
              <svg width="30" height="12" aria-hidden="true">
                <line x1="1" y1="6" x2="29" y2="6" stroke={visual.color} strokeWidth="2" strokeDasharray={visual.dash} />
                <Point x={15} y={6} visual={visual} />
              </svg>
              <span className={css.legendCopy}>
                <span>{copy?.primary ?? label}</span>
                {copy?.secondary === '' || copy?.secondary === undefined ? null : <small>{copy.secondary}</small>}
              </span>
            </button>
          )
        })}
      </div>
      <div className={css.chartCanvas}>
        <svg viewBox="0 0 540 244" role="img" aria-label={`${t('trendAria')}: ${focusedDate}`}>
          {[0, 1, 2, 3, 4].map(index => (
            <line key={index} x1="8" x2="532" y1={20 + index * 51} y2={20 + index * 51} className={css.gridLine} />
          ))}
          {visible.map((series) => {
            const visual = resolveVisual(series)
            const value = series.values[focusIndex] ?? 0
            const pointY = 20 + 204 * (1 - value / max)
            const label = seriesLabel(series, mode, t)
            return (
              <g key={series.id}>
                <path
                  data-series={series.id}
                  d={linePath(series.values, max)}
                  fill="none"
                  stroke={visual.color}
                  strokeWidth="2"
                  strokeDasharray={visual.dash}
                  vectorEffect="non-scaling-stroke"
                />
                <Point x={focusX} y={pointY} visual={visual} />
                <title>{`${label}: ${formatCount(value)}`}</title>
              </g>
            )
          })}
          <line x1={focusX} x2={focusX} y1="20" y2="224" className={css.focusLine} />
        </svg>
        <div
          className={css.chartFocus}
          tabIndex={0}
          role="slider"
          aria-label={t('trendFocus')}
          aria-valuemin={0}
          aria-valuemax={Math.max(0, data.dates.length - 1)}
          aria-valuenow={focusIndex}
          aria-valuetext={focusedAria}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            if (rect.width <= 0 || data.dates.length <= 1) return
            const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
            setFocusIndex(Math.round(ratio * (data.dates.length - 1)))
          }}
          onKeyDown={moveFocus}
        />
        <div className={css.tooltip} role="tooltip">
          <strong>{focusedDate}</strong>
          {visible.map(series => (
            <span key={series.id}>{`${seriesLabel(series, mode, t)} ${formatCount(series.values[focusIndex] ?? 0)}`}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

interface ActivityCellView {
  readonly key: string
  readonly label: string
  readonly level: HeatmapCell['level']
}

function activityCells(
  snapshot: TokenUsageReportSnapshot,
  mode: HeatmapMode,
  t: Copy,
): ActivityCellView[] {
  if (mode === 'weekly') {
    return buildWeeklyHeatmap(snapshot).map((cell: WeeklyHeatmapCell) => ({
      key: cell.from,
      level: cell.level,
      label: replace(t('weeklyCell'), {
        from: cell.from, through: cell.through, count: formatCount(cell.totalTokens),
      }),
    }))
  }
  const cells = mode === 'cumulative' ? buildCumulativeHeatmap(snapshot) : buildHeatmap(snapshot)
  return cells.map(cell => ({
    key: cell.date,
    level: cell.level,
    label: mode === 'cumulative'
      ? replace(t('cumulativeCell'), { date: cell.date, count: formatCount(cell.totalTokens) })
      : `${cell.date}: ${formatCount(cell.totalTokens)}`,
  }))
}

function monthLabels(cells: readonly ActivityCellView[]): ReactNode {
  const labels: Array<{ key: string; label: string; column: number }> = []
  let previous = ''
  cells.forEach((cell, index) => {
    const month = cell.key.slice(0, 7)
    if (month === previous) return
    previous = month
    const [year, monthNumber] = month.split('-').map(Number)
    labels.push({
      key: month,
      label: new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' })
        .format(new Date(Date.UTC(year ?? 0, (monthNumber ?? 1) - 1, 1))),
      column: Math.floor(index / 7) + 1,
    })
  })
  return labels.map(label => (
    <span key={label.key} style={{ gridColumnStart: label.column }}>{label.label}</span>
  ))
}

function ActivityView({ snapshot, t }: { snapshot: TokenUsageReportSnapshot; t: Copy }): ReactNode {
  const [mode, setMode] = useState<HeatmapMode>('daily')
  const [focusIndex, setFocusIndex] = useState(0)
  const cellRefs = useRef<Array<HTMLSpanElement | null>>([])
  const cells = useMemo(() => activityCells(snapshot, mode, t), [mode, snapshot, t])
  useEffect(() => { setFocusIndex(0) }, [mode])
  const ariaLabel = mode === 'daily'
    ? t('heatmapAria')
    : mode === 'weekly' ? t('weeklyHeatmapAria') : t('cumulativeHeatmapAria')

  const moveFocus = (event: KeyboardEvent<HTMLSpanElement>, index: number): void => {
    const rowWidth = mode === 'weekly' ? 13 : 7
    let next = index
    if (event.key === 'ArrowLeft') next += mode === 'weekly' ? -1 : -7
    else if (event.key === 'ArrowRight') next += mode === 'weekly' ? 1 : 7
    else if (event.key === 'ArrowUp') next -= mode === 'weekly' ? rowWidth : 1
    else if (event.key === 'ArrowDown') next += mode === 'weekly' ? rowWidth : 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = cells.length - 1
    else return
    event.preventDefault()
    const bounded = Math.max(0, Math.min(cells.length - 1, next))
    setFocusIndex(bounded)
    cellRefs.current[bounded]?.focus()
  }

  return (
    <section className={css.activitySection}>
      <div className={css.sectionHeading}>
        <div>
          <h3>{t('activity')}</h3>
          {mode === 'cumulative' ? <p className={css.viewNote}>{t('cumulativeNote')}</p> : null}
        </div>
        <div className={css.segmented} aria-label={t('activityAggregation')}>
          {(['daily', 'weekly', 'cumulative'] as const).map(value => (
            <button key={value} type="button" aria-pressed={mode === value} onClick={() => { setMode(value) }}>
              {t(value)}
            </button>
          ))}
        </div>
      </div>
      {mode === 'weekly' ? null : <div className={css.monthLabels}>{monthLabels(cells)}</div>}
      <div className={css.heatmapScroll}>
        <div
          className={mode === 'weekly' ? css.weeklyHeatmap : css.heatmap}
          role="grid"
          aria-label={ariaLabel}
        >
          {cells.map((cell, index) => (
            <span
              key={cell.key}
              ref={(element) => { cellRefs.current[index] = element }}
              role="gridcell"
              tabIndex={focusIndex === index ? 0 : -1}
              data-level={cell.level}
              className={mode === 'weekly' ? css.weekCell : css.heatCell}
              title={cell.label}
              aria-label={cell.label}
              onFocus={() => { setFocusIndex(index) }}
              onKeyDown={(event) => { moveFocus(event, index) }}
            />
          ))}
        </div>
      </div>
      <p className={css.visuallyHidden} aria-live="polite">{cells[focusIndex]?.label ?? ''}</p>
      <div className={css.heatLegend} aria-hidden="true">
        <span>{t('less')}</span>
        {[0, 1, 2, 3, 4, 5].map(level => <i key={level} data-level={level} className={css.heatCell} />)}
        <span>{t('more')}</span>
      </div>
    </section>
  )
}

function PeriodSwitch({ period, setPeriod, t }: {
  period: UsagePeriod
  setPeriod: (period: UsagePeriod) => void
  t: Copy
}): ReactNode {
  return (
    <div className={css.segmented}>
      {PERIODS.map(value => (
        <button key={value} type="button" aria-pressed={period === value} onClick={() => { setPeriod(value) }}>
          {t(periodCopy(value))}
        </button>
      ))}
    </div>
  )
}

function TrendView({
  snapshot,
  period,
  setPeriod,
  t,
  resolveVisual,
}: {
  snapshot: TokenUsageReportSnapshot
  period: UsagePeriod
  setPeriod: (period: UsagePeriod) => void
  t: Copy
  resolveVisual: VisualResolver
}): ReactNode {
  const [mode, setMode] = useState<TrendMode>('model')
  const trend = mode === 'model' ? buildModelTrend(snapshot, period) : buildTypeTrend(snapshot, period)
  return (
    <section className={css.trendSection} data-token-usage-trend>
      <div className={css.sectionHeading}>
        <h3>{t('trend')}</h3>
        <div className={css.switches}>
          <PeriodSwitch period={period} setPeriod={setPeriod} t={t} />
          <div className={css.segmented}>
            <button type="button" aria-pressed={mode === 'model'} onClick={() => { setMode('model') }}>{t('byModel')}</button>
            <button type="button" aria-pressed={mode === 'type'} onClick={() => { setMode('type') }}>{t('byType')}</button>
          </div>
        </div>
      </div>
      <TrendChart data={trend} mode={mode} t={t} resolveVisual={resolveVisual} />
    </section>
  )
}

function ModelsView({
  snapshot,
  period,
  setPeriod,
  t,
}: {
  snapshot: TokenUsageReportSnapshot
  period: UsagePeriod
  setPeriod: (period: UsagePeriod) => void
  t: Copy
}): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const ranking = rankRoutes(snapshot, period)
  const visible = expanded ? ranking : ranking.slice(0, 5)
  return (
    <section className={css.rankingSection} aria-label={t('rankingAria')}>
      <div className={css.sectionHeading}>
        <h3>{t('modelRanking')}</h3>
        <PeriodSwitch period={period} setPeriod={setPeriod} t={t} />
      </div>
      {ranking.length === 0
        ? <p className={css.muted}>{t('noPeriodUsage')}</p>
        : (
          <>
            <ol className={css.ranking}>
              {visible.map((row, index) => {
                const route = routeCopy(row.route, t)
                const details = `${t('input')} ${formatCount(row.inputTokens)} · ${t('output')} ${formatCount(row.outputTokens)}`
                return (
                  <li key={row.id} aria-label={`${index + 1}. ${route.accessible}; ${formatCount(row.totalTokens)}; ${formatPercent(row.share)}; ${details}`} tabIndex={0}>
                    <span className={css.rank}>{index + 1}</span>
                    <span className={css.route} title={route.accessible}>
                      <strong>{route.primary}</strong>
                      {route.secondary === '' ? null : <small>{route.secondary}</small>}
                    </span>
                    <span className={css.bar} aria-hidden="true"><i style={{ '--usage-share': `${row.share * 100}%` } as CSSProperties} /></span>
                    <strong className={css.routeTotal}>{formatCount(row.totalTokens)}</strong>
                    <span className={css.modelDetails}>{`${t('share')} ${formatPercent(row.share)} · ${details}`}</span>
                  </li>
                )
              })}
            </ol>
            {ranking.length > 5
              ? (
                <button type="button" className={css.expandButton} onClick={() => { setExpanded(value => !value) }}>
                  {expanded ? t('showTopModels') : replace(t('showAllModels'), { count: ranking.length })}
                </button>
              )
              : null}
          </>
        )}
    </section>
  )
}

/**
 * Render the Token usage settings page.
 * @param props - slot-injected dependencies.
 * @returns section tree, or null until injection is complete.
 */
export function TokenUsageSection(props: TokenUsageSectionProps): ReactNode {
  const { controller, useSnapshot, t } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined) return null
  return <Loaded controller={controller} useSnapshot={useSnapshot} t={t} />
}

function Loaded({ controller, useSnapshot, t }: InjectFace<TokenUsageSectionInjected>): ReactNode {
  const state = useSnapshot(snapshot => snapshot)
  const [view, setView] = useState<DashboardView>('activity')
  const [period, setPeriod] = useState<UsagePeriod>(30)
  const visualResolver = useRef<VisualResolver>(createVisualResolver()).current
  useEffect(() => controller.start(), [controller])

  if (state.status === 'error' && state.snapshot === null) {
    return (
      <section className={css.section}>
        <h2>{t('title')}</h2>
        <div className={css.centerState}>
          <p>{t('loadFailed')}</p>
          <button type="button" className={css.secondaryButton} onClick={() => { void controller.refresh() }}>{t('retry')}</button>
        </div>
      </section>
    )
  }

  if (state.snapshot === null) {
    return (
      <section className={css.section}>
        <h2>{t('title')}</h2>
        <p className={css.centerState}>{t('refreshing')}</p>
      </section>
    )
  }

  const snapshot = state.snapshot
  const metrics = deriveLifetimeMetrics(snapshot.lifetime)
  const isEmpty = metrics.totalTokens === 0
  const updated = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(new Date(state.lastUpdated ?? snapshot.generatedAt))

  return (
    <section className={css.section} data-token-usage-section>
      <header className={css.pageHeader}>
        <div>
          <h2>{t('title')}</h2>
          <p>{t('intro')}</p>
        </div>
        <div className={css.refreshControls}>
          <label>
            <span className={css.visuallyHidden}>{t('refreshInterval')}</span>
            <select
              aria-label={t('refreshInterval')}
              value={state.refreshIntervalSeconds}
              onChange={(event) => { controller.setRefreshInterval(Number(event.target.value) as RefreshIntervalSeconds) }}
            >
              {REFRESH_INTERVALS.map(interval => (
                <option key={interval} value={interval}>{replace(t('refreshEvery'), { seconds: interval })}</option>
              ))}
            </select>
          </label>
          <button type="button" className={css.iconButton} aria-label={t('refreshNow')} title={t('refreshNow')} onClick={() => { void controller.refresh() }}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.2 5.2A5.7 5.7 0 1 0 13 11M13.2 2.5v2.9h-2.9" /></svg>
          </button>
          <span className={css.updated}>{state.refreshing ? t('refreshing') : replace(t('lastUpdated'), { time: updated })}</span>
        </div>
      </header>

      {state.stale ? <p className={css.warning} role="status">{t('stale')}</p> : null}
      {snapshot.coverage.failedSessionCount > 0
        ? <p className={css.warning} role="status">{replace(t('partial'), { count: snapshot.coverage.failedSessionCount })}</p>
        : null}

      {isEmpty
        ? <p className={css.centerState}>{t('empty')}</p>
        : (
          <>
            <div className={css.metrics}>
              <article data-testid="metric-total"><span>{t('totalTokens')}</span><strong>{formatCount(metrics.totalTokens)}</strong></article>
              <article data-testid="metric-input"><span>{t('inputTokens')}</span><strong>{formatCount(metrics.inputTokens)}</strong></article>
              <article data-testid="metric-output"><span>{t('outputTokens')}</span><strong>{formatCount(metrics.outputTokens)}</strong></article>
              <article data-testid="metric-cache-hit"><span>{t('cacheHitRate')}</span><strong>{metrics.cacheHitRate === null ? '—' : formatPercent(metrics.cacheHitRate)}</strong></article>
            </div>

            <div className={css.viewTabs} role="group" aria-label={t('dashboardViews')}>
              {(['activity', 'trend', 'models'] as const).map(next => (
                <button key={next} type="button" aria-pressed={view === next} onClick={() => { setView(next) }}>
                  {t(next === 'activity' ? 'activityTab' : next === 'trend' ? 'trendTab' : 'modelsTab')}
                </button>
              ))}
            </div>

            <div className={css.viewPanel}>
              {view === 'activity' ? <ActivityView snapshot={snapshot} t={t} /> : null}
              {view === 'trend'
                ? <TrendView snapshot={snapshot} period={period} setPeriod={setPeriod} t={t} resolveVisual={visualResolver} />
                : null}
              {view === 'models'
                ? <ModelsView snapshot={snapshot} period={period} setPeriod={setPeriod} t={t} />
                : null}
            </div>
          </>
        )}
    </section>
  )
}
