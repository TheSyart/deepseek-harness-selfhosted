// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  TokenUsageBuckets,
  TokenUsageReportSnapshot,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { TokenUsageReportController } from '../src/client/controller.ts'
import { TokenUsageSection } from '../src/client/TokenUsageSection.tsx'
import type { TokenUsageSectionProps } from '../src/client/TokenUsageSection.tsx'
import { en } from '../src/client/locales.ts'
import type { TokenUsageSettings } from '../src/token-usage-settings.ts'

afterEach(cleanup)

const buckets = (
  uncachedInputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
  outputTokens: number,
): TokenUsageBuckets => ({
  uncachedInputTokens, cacheReadTokens, cacheWriteTokens, outputTokens,
})

function snapshot(overrides: Partial<TokenUsageReportSnapshot> = {}): TokenUsageReportSnapshot {
  return {
    generatedAt: Date.UTC(2026, 7, 23, 6, 30),
    timeZone: 'Asia/Shanghai',
    window: { from: '2025-08-24', through: '2026-08-23', days: 365 },
    lifetime: buckets(1_000, 2_000, 500, 1_500),
    coverage: { sessionCount: 9, failedSessionCount: 0 },
    days: [
      {
        date: '2026-08-22',
        buckets: buckets(280, 280, 140, 700),
        routes: Array.from({ length: 7 }, (_, index) => ({
          route: { kind: 'model' as const, provider: `provider-${index + 1}`, model: `model-${index + 1}` },
          buckets: buckets((index + 1) * 10, (index + 1) * 10, 0, (index + 1) * 20),
        })),
      },
      {
        date: '2026-08-23',
        buckets: buckets(40, 20, 10, 30),
        routes: [{
          route: { kind: 'unknown' as const },
          buckets: buckets(40, 20, 10, 30),
        }],
      },
    ],
    ...overrides,
  }
}

class Scope implements SettingsScope<TokenUsageSettings> {
  readonly current: SettingsScopeSnapshot<TokenUsageSettings> = {
    status: 'ready', value: { refreshIntervalSeconds: 30 }, base: {}, user: {},
    revision: 0, writable: true, mode: 'host',
  }
  getSnapshot = () => this.current
  subscribe = () => () => {}
  set = vi.fn(async () => {})
  unset = vi.fn(async () => {})
}

async function mount(report: TokenUsageReportSnapshot = snapshot()) {
  const controller = new TokenUsageReportController(
    async () => report,
    new Scope(),
    report.timeZone,
    {
      visibility: { hidden: false, subscribe: () => () => {} },
      setInterval: () => 1 as never,
      clearInterval: () => {},
    },
  )
  await controller.refresh()
  const props: TokenUsageSectionProps = {
    controller,
    useSnapshot: bindSnapshotSelector(controller.store),
    t: key => en[key],
  }
  const view = render(<TokenUsageSection {...props} />)
  return { controller, view }
}

describe('TokenUsageSection', () => {
  it('renders nothing until the slot injects its dependencies', () => {
    render(<TokenUsageSection {...({} as TokenUsageSectionProps)} />)
    expect(document.body.textContent).toBe('')
  })

  it('renders lifetime formulas, partial coverage, and an activity-first view', async () => {
    await mount(snapshot({ coverage: { sessionCount: 8, failedSessionCount: 1 } }))
    expect(screen.getByRole('heading', { name: en.title })).toBeTruthy()
    expect(screen.getByTestId('metric-total').textContent).toContain('5K')
    expect(screen.getByTestId('metric-input').textContent).toContain('3.5K')
    expect(screen.getByTestId('metric-output').textContent).toContain('1.5K')
    expect(screen.getByTestId('metric-cache-hit').textContent).toContain('57.1%')
    expect(screen.getByRole('status').textContent).toContain('Incomplete report: 1 sessions')
    expect(screen.getByRole('button', { name: 'Activity' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByLabelText(en.heatmapAria).querySelectorAll('[role="gridcell"]')).toHaveLength(365)
    expect(screen.queryByLabelText(en.rankingAria)).toBeNull()
  })

  it('distinguishes model lines without end labels and supports legend and date keyboard controls', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Trend' }))
    const chart = screen.getByLabelText(en.trendAria)
    expect(within(chart).getAllByRole('button')).toHaveLength(6)
    expect(within(chart).getByRole('button', { name: 'model-7, provider-7' })).toBeTruthy()
    expect(within(chart).getByRole('button', { name: en.other })).toBeTruthy()
    expect(chart.querySelectorAll('path[data-series]').length).toBe(6)
    expect(new Set([...chart.querySelectorAll('path[data-series]')].map(path => path.getAttribute('stroke'))).size).toBe(6)
    expect(new Set([...chart.querySelectorAll('path[data-series]')].map(path => path.getAttribute('stroke-dasharray'))).size).toBeGreaterThan(1)
    expect(chart.querySelectorAll('[data-end-label]').length).toBe(0)

    const toggle = within(chart).getByRole('button', { name: 'model-7, provider-7' })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(chart.querySelectorAll('path[data-series]').length).toBe(5)

    const focus = within(chart).getByRole('slider', { name: en.trendFocus })
    vi.spyOn(focus, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      width: 290,
      right: 390,
      top: 0,
      bottom: 164,
      height: 164,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    })
    fireEvent.pointerMove(focus, { clientX: 100 })
    expect(within(chart).getByRole('tooltip').textContent).toContain('2026-07-25')
    expect(focus.getAttribute('aria-valuetext')).toContain('model-6, provider-6')

    focus.focus()
    fireEvent.keyDown(focus, { key: 'ArrowRight' })
    expect(within(chart).getByRole('tooltip').textContent).toContain('2026-07-26')
    fireEvent.keyDown(focus, { key: 'End' })
    expect(within(chart).getByRole('tooltip').textContent).toContain('2026-08-23')
    fireEvent.keyDown(focus, { key: 'PageUp' })
    expect(within(chart).getByRole('tooltip').textContent).toContain('2026-08-16')
  })

  it('switches daily, weekly, and cumulative activity with a roving grid focus', async () => {
    await mount()
    const daily = screen.getByLabelText(en.heatmapAria)
    const firstDaily = daily.querySelector<HTMLElement>('[role="gridcell"]')
    expect(firstDaily?.tabIndex).toBe(0)
    firstDaily?.focus()
    fireEvent.keyDown(firstDaily as HTMLElement, { key: 'End' })
    expect(document.activeElement?.getAttribute('aria-label')).toContain('2026-08-23')

    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }))
    expect(screen.getByLabelText('Weekly Token activity for the past 365 days').querySelectorAll('[role="gridcell"]')).toHaveLength(53)
    fireEvent.click(screen.getByRole('button', { name: 'Cumulative' }))
    expect(screen.getByLabelText('Cumulative Token activity within the rolling 365-day window').querySelectorAll('[role="gridcell"]')).toHaveLength(365)
  })

  it('shares the selected period across trend and models, and expands the full ranking', async () => {
    const mounted = await mount()
    const refresh = vi.spyOn(mounted.controller, 'refresh').mockResolvedValue()
    fireEvent.click(screen.getByRole('button', { name: 'Trend' }))
    fireEvent.click(screen.getByRole('button', { name: en.period90 }))
    fireEvent.click(screen.getByRole('button', { name: 'Models' }))
    expect(screen.getByRole('button', { name: en.period90 }).getAttribute('aria-pressed')).toBe('true')
    const ranking = screen.getByLabelText(en.rankingAria)
    expect(within(ranking).getAllByRole('listitem')).toHaveLength(5)
    expect(within(ranking).getByText('model-7')).toBeTruthy()
    expect(within(ranking).getByText('provider-7')).toBeTruthy()
    expect(within(ranking).queryByText('model-1')).toBeNull()
    fireEvent.click(within(ranking).getByRole('button', { name: /Show all 8 models/ }))
    expect(within(ranking).getAllByRole('listitem')).toHaveLength(8)
    expect(within(ranking).getByText('model-1')).toBeTruthy()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('switches trend type mode and exposes refresh controls', async () => {
    const { controller } = await mount()
    const refresh = vi.spyOn(controller, 'refresh').mockResolvedValue()
    fireEvent.click(screen.getByRole('button', { name: 'Trend' }))
    fireEvent.click(screen.getByRole('button', { name: en.byType }))
    expect(screen.getByRole('button', { name: en.uncachedInput })).toBeTruthy()
    expect(screen.getByRole('button', { name: en.cacheRead })).toBeTruthy()
    expect(screen.getByRole('button', { name: en.cacheWrite })).toBeTruthy()
    expect(screen.getByRole('button', { name: en.output })).toBeTruthy()
    fireEvent.change(screen.getByLabelText(en.refreshInterval), { target: { value: '5' } })
    expect(controller.store.getSnapshot().refreshIntervalSeconds).toBe(5)
    fireEvent.click(screen.getByRole('button', { name: en.refreshNow }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('shows empty, initial-error, and stale-data states without discarding the report', async () => {
    const empty = snapshot({ lifetime: buckets(0, 0, 0, 0), days: [] })
    const mounted = await mount(empty)
    expect(screen.getByText(en.empty)).toBeTruthy()
    mounted.view.unmount()

    const controller = new TokenUsageReportController(
      async () => { throw new Error('offline') }, new Scope(), 'UTC',
      {
        visibility: { hidden: false, subscribe: () => () => {} },
        setInterval: () => 1 as never,
        clearInterval: () => {},
      },
    )
    await controller.refresh()
    render(<TokenUsageSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      t={key => en[key]}
    />)
    await waitFor(() => { expect(screen.getByText(en.loadFailed)).toBeTruthy() })
    expect(screen.getByRole('button', { name: en.retry })).toBeTruthy()
  })
})
