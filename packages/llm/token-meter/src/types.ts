/**
 * Public configuration and measurement vocabulary for replay token metering.
 *
 * @module @deepseek-ai/dsh-token-meter/types
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-projection/types'

export type { ContextBreakdownProjection, ContextPressureProjection, TokenUsageProjection } from './projection.ts'

/** Token-meter plugin configuration; the fixed estimator has no settings. */
export type TokenMeterConfig = Record<string, never>

/** The baseline from which a signed surface delta produces current pressure. */
export type TokenMeasurementBaseline =
  | { readonly kind: 'none'; readonly tokens: 0 }
  | { readonly kind: 'estimated'; readonly tokens: number }
  | { readonly kind: 'usage'; readonly tokens: number; readonly usage: Readonly<TokenUsage> }

/** Detached immutable request-pressure and surface snapshot at one consumed log revision. */
export interface TokenMeasurement {
  /** Number of durable events consumed; equal to the next unread event seq. */
  readonly logRevision: number
  /** Provider or heuristic anchor used for this measurement. */
  readonly baseline: TokenMeasurementBaseline
  /** Signed repricing of current surface content relative to the baseline anchor. */
  readonly surfaceDeltaTokens: number
  /** Non-negative current request-and-response pressure. */
  readonly totalTokens: number
  /** Total heuristic tokens across the current surface. */
  readonly surfaceTokens: number
  /** Current surface nodes in positional head-to-tail order. */
  readonly nodes: readonly TokenSurfaceNode[]
}

/** One token-priced node in the current ordered session surface. */
export interface TokenSurfaceNode {
  /** Durable sequence number of the surface event. */
  readonly seq: number
  /** Heuristic tokens for the exact message projected by this node. */
  readonly tokens: number
}

/** Exact provider route attached to one provider-reported usage sample. */
export type TokenUsageTimelineRoute =
  | { readonly kind: 'model'; readonly provider: string; readonly model: string }
  | { readonly kind: 'unknown' }

/** One model call's disjoint provider-reported token buckets. */
export interface TokenUsageTimelineBuckets {
  readonly uncachedInputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}

/** One model call retained by the Host-only timeline projection. */
export interface TokenUsageTimelineSample {
  /** Seq of the first usage event reported for this turn and step. */
  readonly seq: number
  /** Millisecond timestamp of the matching `step/start` event. */
  readonly time: number
  readonly turn: number
  readonly step: number
  readonly route: TokenUsageTimelineRoute
  readonly buckets: TokenUsageTimelineBuckets
}

/** Reverse-linked bounded block used for append-oriented timeline persistence. */
export interface TokenUsageTimelineChunk {
  readonly samples: readonly TokenUsageTimelineSample[]
  readonly previous: TokenUsageTimelineChunk | null
}

/** Persistable Host-only state used to aggregate usage across saved sessions. */
export interface TokenUsageTimelineState {
  readonly route: TokenUsageTimelineRoute
  readonly step: { readonly turn: number; readonly step: number; readonly time: number } | null
  readonly head: TokenUsageTimelineChunk | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    tokenUsageTimeline: TokenUsageTimelineState
  }
}
