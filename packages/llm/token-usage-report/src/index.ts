/** Global provider-reported token usage Remote. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import type { TokenUsageTimelineState } from '@deepseek-ai/dsh-token-meter'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { aggregateTokenUsage, validateTokenUsageTimeZone } from './report.ts'
import type {
  TokenUsageReportRequest,
  TokenUsageReportSnapshot,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    tokenUsageReport: TokenUsageReportService
  }
}

/** Required limit for concurrent cold-session projection reads. */
export interface Config {
  /** Maximum cold-session projection reads executed concurrently. */
  readonly readConcurrency: number
}

export const Config: z<Config> = z.object({
  readConcurrency: z.natural().min(1).required(),
})

interface CachedTimeline {
  readonly revision: SessionPersistenceRevision
  readonly timeline: TokenUsageTimelineState
}

interface ResolvedTimeline {
  readonly header: SessionHeader
  readonly timeline: TokenUsageTimelineState
}

/** Host Remote that merges live and persisted session usage. */
export class TokenUsageReportService extends TypertRemoteService {
  static inject = [
    'sessions',
    'sessionPersistence',
    'sessionProjections',
    'sessionProjectionCache',
    'tokenMeter',
  ]

  static Config: z<Config> = Config

  private readonly cold = new Map<SessionId, CachedTimeline>()

  constructor(ctx: Context, readonly config: Config) {
    super(ctx, 'tokenUsageReport')
  }

  /**
   * Merge every persisted and live session into one provider-usage report.
   * A live session supersedes the same persisted id. Cold failures exclude
   * only that session and increment coverage; listing and cancellation
   * failures reject the whole request.
   * @param request - IANA time zone used for calendar-day grouping.
   * @param signal - optional caller cancellation.
   * @returns global lifetime and rolling-365-day usage.
   */
  @Remote('snapshot')
  async snapshot(
    request: TokenUsageReportRequest,
    signal?: AbortSignal,
  ): Promise<TokenUsageReportSnapshot> {
    validateTokenUsageTimeZone(request.timeZone)
    const listed = await this.ctx.sessionPersistence.listSnapshots(signal)
    const live = new Map(this.ctx.sessions.list().map(session => [session.id, session]))
    const listedIds = new Set(listed.map(item => item.header.id))
    for (const id of this.cold.keys()) {
      if (!listedIds.has(id) || live.has(id)) this.cold.delete(id)
    }

    const resolved: ResolvedTimeline[] = []
    let failedSessionCount = 0
    for (const session of live.values()) {
      const timeline = this.ctx.sessionProjections.stateOf(session, 'tokenUsageTimeline')
      if (timeline === undefined) {
        throw new Error('tokenUsageTimeline projection is not registered')
      }
      resolved.push({ header: session.header, timeline })
    }

    const coldItems = listed.filter(item => !live.has(item.header.id))
    let nextIndex = 0
    const worker = async (): Promise<void> => {
      while (nextIndex < coldItems.length) {
        const index = nextIndex
        nextIndex += 1
        const item = coldItems[index]
        /* v8 ignore next -- the index is claimed only while it is in bounds. */
        if (item === undefined) continue
        const cached = this.cold.get(item.header.id)
        if (cached?.revision === item.revision) {
          resolved.push({ header: item.header, timeline: cached.timeline })
          continue
        }
        let timeline: TokenUsageTimelineState | undefined
        try {
          timeline = await this.ctx.sessionProjectionCache.coldState(
            item.header.id,
            'tokenUsageTimeline',
            signal,
          )
        } catch (error) {
          if (signal?.aborted === true) throw error
          failedSessionCount += 1
          continue
        }
        if (timeline === undefined) {
          throw new Error('tokenUsageTimeline projection is not registered')
        }
        this.cold.set(item.header.id, { revision: item.revision, timeline })
        resolved.push({ header: item.header, timeline })
      }
    }
    const workerCount = Math.min(this.config.readConcurrency, coldItems.length)
    await Promise.all(Array.from({ length: workerCount }, worker))

    return aggregateTokenUsage({
      generatedAt: Date.now(),
      timeZone: request.timeZone,
      sessions: resolved,
      failedSessionCount,
    })
  }
}

export default TokenUsageReportService
