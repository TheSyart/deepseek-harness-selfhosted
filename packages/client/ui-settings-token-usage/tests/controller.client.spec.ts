import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TokenUsageReportSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import {
  TokenUsageReportController,
  type PollingEnvironment,
} from '../src/client/controller.ts'
import type { TokenUsageSettings } from '../src/token-usage-settings.ts'

function report(generatedAt = 100): TokenUsageReportSnapshot {
  return {
    generatedAt,
    timeZone: 'UTC',
    window: { from: '2025-01-01', through: '2025-12-31', days: 365 },
    lifetime: { uncachedInputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 },
    coverage: { sessionCount: 1, failedSessionCount: 0 },
    days: [],
  }
}

class FakeVisibility {
  hidden = false
  private readonly listeners = new Set<() => void>()

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden
    for (const listener of this.listeners) listener()
  }
}

class FakeScope implements SettingsScope<TokenUsageSettings> {
  snapshot: SettingsScopeSnapshot<TokenUsageSettings> = {
    status: 'ready',
    value: { refreshIntervalSeconds: 30 },
    base: {},
    user: {},
    revision: 0,
    writable: true,
    mode: 'host',
  }
  readonly set = vi.fn(async () => {})
  readonly unset = vi.fn(async () => {})
  private readonly listeners = new Set<() => void>()
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}

function environment(visibility: FakeVisibility): PollingEnvironment {
  return {
    visibility,
    setInterval: (callback, delay) => globalThis.setInterval(callback, delay),
    clearInterval: handle => globalThis.clearInterval(handle),
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('TokenUsageReportController', () => {
  it('loads immediately, polls only while visible, and refreshes on visibility return', async () => {
    vi.useFakeTimers()
    const visibility = new FakeVisibility()
    const fetch = vi.fn(async () => report())
    const controller = new TokenUsageReportController(fetch, new FakeScope(), 'UTC', environment(visibility))
    const stop = controller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(29_999)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(2)

    visibility.setHidden(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetch).toHaveBeenCalledTimes(2)
    visibility.setHidden(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(3)

    stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('remembers a supported interval in-process, persists it, and reschedules polling', async () => {
    vi.useFakeTimers()
    const visibility = new FakeVisibility()
    const scope = new FakeScope()
    const fetch = vi.fn(async () => report())
    const controller = new TokenUsageReportController(fetch, scope, 'UTC', environment(visibility))
    const stop = controller.start()
    await vi.advanceTimersByTimeAsync(0)

    controller.setRefreshInterval(5)
    expect(controller.store.getSnapshot().refreshIntervalSeconds).toBe(5)
    expect(scope.set).toHaveBeenCalledWith('refreshIntervalSeconds', 5)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetch).toHaveBeenCalledTimes(2)
    stop()
  })

  it('keeps requests single-flight and marks last good data stale after a refresh failure', async () => {
    let resolveFirst: ((value: TokenUsageReportSnapshot) => void) | undefined
    const first = new Promise<TokenUsageReportSnapshot>((resolve) => { resolveFirst = resolve })
    const fetch = vi.fn()
      .mockReturnValueOnce(first)
      .mockRejectedValueOnce(new Error('offline'))
    const controller = new TokenUsageReportController(fetch, new FakeScope(), 'UTC', environment(new FakeVisibility()))

    const pending = controller.refresh()
    void controller.refresh()
    expect(fetch).toHaveBeenCalledTimes(1)
    resolveFirst?.(report(123))
    await pending
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', stale: false, lastUpdated: 123 })

    await controller.refresh()
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready', stale: true, error: 'offline', lastUpdated: 123,
    })
    expect(controller.store.getSnapshot().snapshot).toEqual(report(123))
  })

  it('shows an initial retry state and aborts an in-flight request on teardown', async () => {
    const first = vi.fn()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce(report(222))
    const controller = new TokenUsageReportController(first, new FakeScope(), 'UTC', environment(new FakeVisibility()))
    await controller.refresh()
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'error', stale: false, error: 'unavailable' })
    await controller.refresh()
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', error: null, lastUpdated: 222 })

    let captured: AbortSignal | undefined
    const hanging = new TokenUsageReportController((_request, signal) => {
      captured = signal
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(signal.reason) }, { once: true })
      })
    }, new FakeScope(), 'UTC', environment(new FakeVisibility()))
    const stop = hanging.start()
    stop()
    expect(captured?.aborted).toBe(true)
  })

  it('reaches request quiescence when the owning plugin is disposed', async () => {
    let settled = false
    const controller = new TokenUsageReportController((_request, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        queueMicrotask(() => {
          settled = true
          reject(signal.reason)
        })
      }, { once: true })
    }), new FakeScope(), 'UTC', environment(new FakeVisibility()))
    controller.start()
    await controller.dispose()
    expect(settled).toBe(true)
  })

  it('starts a fresh request when remounted before an aborted request settles', async () => {
    let releaseAbort: (() => void) | undefined
    const fetch = vi.fn((_request, signal: AbortSignal) => new Promise<TokenUsageReportSnapshot>((resolve, reject) => {
      if (fetch.mock.calls.length > 1) {
        resolve(report(333))
        return
      }
      signal.addEventListener('abort', () => {
        releaseAbort = () => { reject(signal.reason) }
      }, { once: true })
    }))
    const controller = new TokenUsageReportController(fetch, new FakeScope(), 'UTC', environment(new FakeVisibility()))

    const firstStop = controller.start()
    firstStop()
    const secondStop = controller.start()
    await Promise.resolve()

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', refreshing: false, lastUpdated: 333 })
    releaseAbort?.()
    await Promise.resolve()
    secondStop()
  })
})
