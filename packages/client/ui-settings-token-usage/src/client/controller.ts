/** Report loading, polling, and settings state for the Token usage page. */

import type {
  TokenUsageReportRequest,
  TokenUsageReportSnapshot,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  createSnapshotStore,
  type SettingsScope,
  type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_REFRESH_INTERVAL_SECONDS,
  isRefreshIntervalSeconds,
  REFRESH_INTERVAL_FIELD,
  type RefreshIntervalSeconds,
  type TokenUsageSettings,
} from '../token-usage-settings.ts'

/** Browser visibility source used to suspend report polling. */
export interface VisibilitySource {
  readonly hidden: boolean
  /**
   * Observe document visibility changes.
   * @param listener - callback invoked after visibility changes.
   * @returns listener disposer.
   */
  subscribe(listener: () => void): () => void
}

/** Timer and visibility operations injected into the report controller. */
export interface PollingEnvironment {
  readonly visibility: VisibilitySource
  readonly setInterval: (
    callback: () => void,
    delay: number,
  ) => ReturnType<typeof globalThis.setInterval>
  readonly clearInterval: (handle: ReturnType<typeof globalThis.setInterval>) => void
}

/** Observable report state consumed by the settings page. */
export interface TokenUsageReportState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  snapshot: TokenUsageReportSnapshot | null
  error: string | null
  stale: boolean
  refreshing: boolean
  refreshIntervalSeconds: RefreshIntervalSeconds
  lastUpdated: number | null
}

/** Remote report loader accepted by the controller. */
export type FetchTokenUsageReport = (
  request: TokenUsageReportRequest,
  signal: AbortSignal,
) => Promise<TokenUsageReportSnapshot>

/** Owns one mounted Token usage page's single-flight refresh lifecycle. */
export class TokenUsageReportController {
  /** Reactive report state. */
  readonly store: SnapshotStore<TokenUsageReportState>

  private started = false
  private interval: ReturnType<typeof globalThis.setInterval> | undefined
  private request: Promise<void> | undefined
  private requestAbort: AbortController | undefined
  private disposeVisibility: (() => void) | undefined
  private disposeSettings: (() => void) | undefined

  /**
   * Create a report controller.
   * @param fetchReport - Host Remote adapter.
   * @param settings - namespace-scoped refresh preference.
   * @param timeZone - browser IANA time zone sent with each request.
   * @param environment - timer and visibility operations.
   */
  constructor(
    private readonly fetchReport: FetchTokenUsageReport,
    private readonly settings: SettingsScope<TokenUsageSettings>,
    private readonly timeZone: string,
    private readonly environment: PollingEnvironment,
  ) {
    const configured = settings.getSnapshot().value?.refreshIntervalSeconds
    this.store = createSnapshotStore({
      status: 'idle',
      snapshot: null,
      error: null,
      stale: false,
      refreshing: false,
      refreshIntervalSeconds: isRefreshIntervalSeconds(configured)
        ? configured
        : DEFAULT_REFRESH_INTERVAL_SECONDS,
      lastUpdated: null,
    })
  }

  /**
   * Start visible-page polling and load the first report immediately.
   * @returns idempotent lifecycle disposer.
   */
  start(): () => void {
    if (!this.started) {
      this.started = true
      this.disposeVisibility = this.environment.visibility.subscribe(() => {
        if (this.environment.visibility.hidden) {
          this.clearTimer()
          return
        }
        void this.refresh()
        this.schedule()
      })
      this.disposeSettings = this.settings.subscribe(() => {
        const value = this.settings.getSnapshot().value?.refreshIntervalSeconds
        if (isRefreshIntervalSeconds(value)
          && value !== this.store.getSnapshot().refreshIntervalSeconds) {
          this.store.update(state => { state.refreshIntervalSeconds = value })
          this.schedule()
        }
      })
      if (!this.environment.visibility.hidden) {
        void this.refresh()
        this.schedule()
      }
    }
    return () => { this.stop() }
  }

  /** Stop polling, unsubscribe observers, and cancel the active request. */
  stop(): void {
    if (!this.started && this.requestAbort === undefined) return
    this.started = false
    this.clearTimer()
    this.disposeVisibility?.()
    this.disposeVisibility = undefined
    this.disposeSettings?.()
    this.disposeSettings = undefined
    const abort = this.requestAbort
    this.requestAbort = undefined
    this.request = undefined
    abort?.abort(new DOMException('Token usage page closed', 'AbortError'))
    this.store.update(state => {
      state.refreshing = false
      if (state.status === 'loading') state.status = 'idle'
    })
  }

  /**
   * Stop the controller and wait until the cancelled Remote call settles.
   * @returns settlement after the controller reaches quiescence.
   */
  async dispose(): Promise<void> {
    const request = this.request
    this.stop()
    await request
  }

  /**
   * Persist and apply one supported refresh interval.
   * @param value - refresh interval selected by the user.
   */
  setRefreshInterval(value: RefreshIntervalSeconds): void {
    if (value === this.store.getSnapshot().refreshIntervalSeconds) return
    this.store.update(state => { state.refreshIntervalSeconds = value })
    this.schedule()
    void this.settings.set(REFRESH_INTERVAL_FIELD, value).catch(() => {
      // The settings scope publishes durable-write failures and recovery itself;
      // this controller intentionally retains the in-process preference.
    })
  }

  /**
   * Load the latest report, sharing an active request with concurrent callers.
   * @returns settlement after this refresh succeeds, fails, or is cancelled.
   */
  refresh(): Promise<void> {
    if (this.request !== undefined) return this.request
    const abort = new AbortController()
    this.requestAbort = abort
    const current = this.store.getSnapshot()
    this.store.update(state => {
      state.status = current.snapshot === null ? 'loading' : 'ready'
      state.refreshing = true
      state.error = null
    })

    const request = (async () => {
      try {
        const snapshot = await this.fetchReport({ timeZone: this.timeZone }, abort.signal)
        if (abort.signal.aborted) return
        this.store.update(state => {
          state.status = 'ready'
          state.snapshot = snapshot
          state.error = null
          state.stale = false
          state.refreshing = false
          state.lastUpdated = snapshot.generatedAt
        })
      } catch (error) {
        if (abort.signal.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        this.store.update(state => {
          state.status = state.snapshot === null ? 'error' : 'ready'
          state.error = message
          state.stale = state.snapshot !== null
          state.refreshing = false
        })
      } finally {
        if (this.requestAbort === abort) {
          this.requestAbort = undefined
          this.request = undefined
        }
      }
    })()
    this.request = request
    return request
  }

  private schedule(): void {
    this.clearTimer()
    if (!this.started || this.environment.visibility.hidden) return
    const delay = this.store.getSnapshot().refreshIntervalSeconds * 1_000
    this.interval = this.environment.setInterval(() => { void this.refresh() }, delay)
  }

  private clearTimer(): void {
    if (this.interval === undefined) return
    this.environment.clearInterval(this.interval)
    this.interval = undefined
  }
}
