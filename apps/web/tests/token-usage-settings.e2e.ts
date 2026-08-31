// Keyless assembled-Web coverage for the global Token usage settings page.
// Provider usage is seeded through real live, persisted, archived, and forked
// Session logs; the browser then crosses the shipped Remote, report service,
// settings shell, and SVG view.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/token-usage-settings', import.meta.url))
const TREND_EXPECTED = join(SNAPSHOT_DIR, 'model-trend.expected.md')
const MODE = webSnapshotMode()
const DAY_MS = 86_400_000
const ROUTES = [
  ['alpha', 'model-a'],
  ['bravo', 'model-b'],
  ['charlie', 'model-c'],
  ['delta', 'model-d'],
  ['echo', 'model-e'],
  ['foxtrot', 'model-f'],
  ['golf', 'model-g'],
] as const

function appendUsage(
  session: Session,
  turn: number,
  provider: string,
  model: string,
  scale: number,
): void {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('request/header', {
    header: { config: { provider, model } },
    reason: turn === 1 ? 'initial' : 'change',
  })
  session.append('assistant/chunk', {
    turn,
    step: 1,
    chunk: {
      type: 'usage',
      usage: {
        inputTokens: scale * 10,
        cacheReadTokens: scale * 4,
        cacheWriteTokens: scale,
        outputTokens: scale * 3,
      },
    },
  })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

function seedMultiModelUsage(scaffold: WebScaffold): void {
  const anchor = Date.now()
  const clock = vi.spyOn(Date, 'now')
  try {
    ROUTES.forEach(([provider, model], routeIndex) => {
      const session = scaffold.ctx.sessions.create(SessionId(`token-usage-${model}`))
      ;[24, 13, 4, 0].forEach((daysAgo, dateIndex) => {
        clock.mockReturnValue(anchor - daysAgo * DAY_MS)
        const routeWeight = ROUTES.length - routeIndex
        const dateWeight = [1, 4, 2, 5][dateIndex] ?? 1
        appendUsage(session, dateIndex + 1, provider, model, routeWeight * dateWeight * 10)
      })
    })
  } finally {
    clock.mockRestore()
  }
}

async function seedColdForkUsage(scaffold: WebScaffold): Promise<void> {
  const parentId = SessionId('token-usage-archived-parent')
  const parent = scaffold.ctx.sessions.prepare(parentId, {
    meta: { createdAt: Date.now() - 2 * DAY_MS, cwd: scaffold.workspaceCwd },
  })
  const detachParent = scaffold.ctx.sessions.enter(parent)
  scaffold.ctx.sessions.announce(parent)
  appendUsage(parent, 1, 'hotel', 'model-h', 2)
  await scaffold.ctx.sessions.flush(parent)
  detachParent()
  await scaffold.ctx.workspaceRegistry.archiveSession(parentId)

  const childId = SessionId('token-usage-cold-child')
  const child = scaffold.ctx.sessions.prepare(childId, {
    seed: parent.events,
    meta: {
      createdAt: Date.now() - DAY_MS,
      cwd: scaffold.workspaceCwd,
      parentSession: parentId,
      seedLength: parent.events.length,
      origin: 'subagent',
      delegationDepth: 1,
    },
  })
  const detachChild = scaffold.ctx.sessions.enter(child)
  scaffold.ctx.sessions.announce(child)
  appendUsage(child, 2, 'india', 'model-i', 3)
  await scaffold.ctx.sessions.flush(child)
  detachChild()

  const report = await scaffold.ctx.tokenUsageReport.snapshot({ timeZone: 'Asia/Shanghai' })
  expect(report.coverage).toEqual({ sessionCount: 9, failedSessionCount: 0 })
  expect(Object.values(report.lifetime).reduce((sum, value) => sum + value, 0)).toBe(60_570)
}

describe('web e2e: global Token usage settings', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    seedMultiModelUsage(scaffold)
    await seedColdForkUsage(scaffold)
    browser = await chromium.launch()
    page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      locale: ZH_BROWSER_LOCALE,
      timezoneId: 'Asia/Shanghai',
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    await assertFixtureInventory(SNAPSHOT_DIR, ['model-trend.expected.md'])
  })

  it('switches usage views and keeps model ranking measures aligned', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-token-usage-settings'))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByRole('button', { name: 'Token 用量', exact: true }).click()
    await dialog.getByRole('heading', { name: 'Token 用量', exact: true }).waitFor({ timeout: 15_000 })

    const daily = dialog.getByRole('grid', { name: '过去 365 天 Token 活跃热力图', exact: true })
    await expect.poll(() => daily.getByRole('gridcell').count()).toBe(365)
    await dialog.getByRole('button', { name: '每周', exact: true }).click()
    const weekly = dialog.getByRole('grid', { name: '过去 365 天每周 Token 活跃度', exact: true })
    await expect.poll(() => weekly.getByRole('gridcell').count()).toBe(53)
    await dialog.getByRole('button', { name: '累计', exact: true }).click()
    const cumulative = dialog.getByRole('grid', { name: '滚动 365 天窗口内的累计 Token 活跃度', exact: true })
    await expect.poll(() => cumulative.getByRole('gridcell').count()).toBe(365)

    await dialog.getByRole('button', { name: '趋势', exact: true }).click()
    const trend = dialog.locator('[data-token-usage-trend]')
    await expect.poll(() => trend.locator('path[data-series]').count(), { timeout: 15_000 }).toBe(6)
    for (const [provider, model] of ROUTES.slice(0, 5)) {
      await trend.getByRole('button', { name: `${model}, ${provider}`, exact: true }).waitFor()
    }
    await trend.getByRole('button', { name: '其他', exact: true }).waitFor()
    expect(await trend.locator('[data-end-label]').count()).toBe(0)
    const modelSnapshot = await captureStableAria(page, '[data-token-usage-trend]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(TREND_EXPECTED, modelSnapshot, MODE)

    await trend.getByRole('button', { name: '90 天', exact: true }).click()
    expect(await trend.getByRole('button', { name: '90 天', exact: true }).getAttribute('aria-pressed')).toBe('true')
    await trend.getByRole('button', { name: '按类型', exact: true }).click()
    await expect.poll(() => trend.locator('path[data-series]').count()).toBe(4)
    for (const label of ['未缓存输入', '缓存读取', '缓存写入', '输出']) {
      await trend.getByRole('button', { name: label, exact: true }).waitFor()
    }

    await dialog
      .getByRole('group', { name: 'Token 用量视图', exact: true })
      .getByRole('button', { name: '模型', exact: true })
      .click()
    expect(await dialog.getByRole('button', { name: '90 天', exact: true }).getAttribute('aria-pressed')).toBe('true')
    const ranking = dialog.getByRole('region', { name: '所选周期的完整模型用量排名', exact: true })
    await expect.poll(() => ranking.getByRole('listitem').count()).toBe(5)
    await ranking.getByRole('button', { name: '显示全部 9 个模型', exact: true }).click()
    await expect.poll(() => ranking.getByRole('listitem').count()).toBe(9)
    const rowGeometry = await ranking.getByRole('listitem').evaluateAll(rows => rows.map(row => {
      const bar = row.querySelector(':scope > span[aria-hidden="true"]')?.getBoundingClientRect()
      const total = row.querySelector(':scope > strong')?.getBoundingClientRect()
      return {
        barLeft: bar?.left,
        barRight: bar?.right,
        totalRight: total?.right,
      }
    }))
    expect(new Set(rowGeometry.map(row => row.barLeft))).toHaveLength(1)
    expect(new Set(rowGeometry.map(row => row.barRight))).toHaveLength(1)
    expect(new Set(rowGeometry.map(row => row.totalRight))).toHaveLength(1)

    await dialog.getByRole('combobox', { name: '自动刷新间隔' }).selectOption('5')
    await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'), {
      timeout: 5_000,
    }).toMatch(/ui-token-usage:[\s\S]*refreshIntervalSeconds: 5/)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
