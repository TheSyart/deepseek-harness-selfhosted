/**
 * Pure folds for durable provider-reported token usage and context occupancy.
 */

import { z } from 'zod'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { ContextPressureProjection, TokenUsageProjection } from './projection.ts'
import type {
  TokenUsageTimelineChunk,
  TokenUsageTimelineRoute,
  TokenUsageTimelineSample,
  TokenUsageTimelineState,
} from './types.ts'
import { foldSurfaceProjection } from './surface-projection.ts'

const zeroBuckets = (): TokenUsageProjection => ({
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

const bucketsFrom = (usage: TokenUsage): TokenUsageProjection => ({
  uncachedInputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  cacheReadTokens: usage.cacheReadTokens ?? 0,
  cacheWriteTokens: usage.cacheWriteTokens ?? 0,
})

const bucketsEqual = (left: TokenUsageProjection, right: TokenUsageProjection): boolean =>
  left.uncachedInputTokens === right.uncachedInputTokens
  && left.outputTokens === right.outputTokens
  && left.cacheReadTokens === right.cacheReadTokens
  && left.cacheWriteTokens === right.cacheWriteTokens

const addReplacing = (
  totals: TokenUsageProjection,
  previous: TokenUsageProjection | undefined,
  next: TokenUsageProjection,
): TokenUsageProjection => ({
  uncachedInputTokens: totals.uncachedInputTokens - (previous?.uncachedInputTokens ?? 0) + next.uncachedInputTokens,
  outputTokens: totals.outputTokens - (previous?.outputTokens ?? 0) + next.outputTokens,
  cacheReadTokens: totals.cacheReadTokens - (previous?.cacheReadTokens ?? 0) + next.cacheReadTokens,
  cacheWriteTokens: totals.cacheWriteTokens - (previous?.cacheWriteTokens ?? 0) + next.cacheWriteTokens,
})

const projectionSchema = z.object({
  uncachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
}).strict()

const timelineRouteSchema: z.ZodType<TokenUsageTimelineRoute> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('model'), provider: z.string().min(1), model: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('unknown') }).strict(),
])

const timelineSampleSchema: z.ZodType<TokenUsageTimelineSample> = z.object({
  seq: z.number().int().nonnegative(),
  time: z.number().finite(),
  turn: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  route: timelineRouteSchema,
  buckets: projectionSchema,
}).strict()

const TIMELINE_CHUNK_SIZE = 128

const timelineChunkSchema: z.ZodType<TokenUsageTimelineChunk> = z.lazy(() => z.object({
  samples: z.array(timelineSampleSchema).min(1).max(TIMELINE_CHUNK_SIZE),
  previous: timelineChunkSchema.nullable(),
}).strict())

const tokenUsageTimelineStateSchema: z.ZodType<TokenUsageTimelineState> = z.object({
  route: timelineRouteSchema,
  step: z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    time: z.number().finite(),
  }).strict().nullable(),
  head: timelineChunkSchema.nullable(),
}).strict()

/**
 * Iterate one append-oriented timeline in original call order.
 * @param state - persisted reverse-linked timeline chunks.
 * @returns the retained provider-usage samples from oldest to newest.
 */
export function* tokenUsageTimelineSamples(
  state: TokenUsageTimelineState,
): Generator<TokenUsageTimelineSample, void> {
  const reverse: TokenUsageTimelineChunk[] = []
  for (let chunk = state.head; chunk !== null; chunk = chunk.previous) reverse.push(chunk)
  for (let chunkIndex = reverse.length - 1; chunkIndex >= 0; chunkIndex -= 1) {
    const chunk = reverse[chunkIndex]
    if (chunk !== undefined) yield* chunk.samples
  }
}

/**
 * The token-usage unit's state schema — the one definition of the state
 * shape; the state type is inferred from it.
 */
const tokenUsageStateSchema = z.object({
  totals: projectionSchema,
  last: z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    buckets: projectionSchema,
  }).nullable(),
}).strict()

type TokenUsageState = z.infer<typeof tokenUsageStateSchema>

const pressureSchema: z.ZodType<ContextPressureProjection> = z.object({
  pressureTokens: z.number().int().nonnegative().optional(),
  projectedTokens: z.number().int().nonnegative().optional(),
  contextWindow: z.number().int().positive().optional(),
}).strict().transform(({ pressureTokens, projectedTokens, contextWindow }) => ({
  ...pressureTokens === undefined ? {} : { pressureTokens },
  ...projectedTokens === undefined ? {} : { projectedTokens },
  ...contextWindow === undefined ? {} : { contextWindow },
}))

/** Prompt-side pressure of one request: input plus cache traffic, no output. */
const pressureFrom = (usage: TokenUsage): number =>
  usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)

/** The usage a chunk or finalized message reports for its step, if any. */
const usageOf = (event: SessionEvent): TokenUsage | undefined =>
  event.type === 'assistant/chunk' && event.data.chunk.type === 'usage'
    ? event.data.chunk.usage
    : event.type === 'assistant/message'
      ? event.data.usage
      : undefined

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    tokenUsage: TokenUsageState
    contextPressure: ContextPressureState
  }
}

/** The context-pressure state schema and source of its inferred type. */
const contextPressureStateSchema = z.object({
  contextWindow: z.number().int().positive().optional(),
  pressureTokens: z.number().int().nonnegative().optional(),
  surfaceTokens: z.number().int().nonnegative(),
  sampledSurfaceTokens: z.number().int().nonnegative().optional(),
  claim: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    tokens: z.number().int().nonnegative(),
  }).optional(),
}).strict()

type ContextPressureState = z.infer<typeof contextPressureStateSchema>

/**
 * Token-meter's session projection unit.
 *
 * Usage chunks provide an early sample that survives a later request failure;
 * an assistant message provides the final sample for the same turn/step. A
 * repeated sample replaces that step's earlier value instead of double
 * counting it. The single `last` slot relies on the session-log invariant
 * that usage reports for one turn/step are adjacent: once a later step begins,
 * a legal log never reports usage for an earlier step again.
 */
export const tokenUsageProjectionDefinition = {
  key: 'tokenUsage',
  stateVersion: 1,
  stateSchema: tokenUsageStateSchema,
  init: () => ({ totals: zeroBuckets(), last: null }),
  apply: (state, event) => {
    let turn: number
    let step: number
    let usage: TokenUsage
    if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
      ;({ turn, step } = event.data)
      usage = event.data.chunk.usage
    } else if (event.type === 'assistant/message' && event.data.usage !== undefined) {
      ;({ turn, step, usage } = event.data)
    } else {
      return state
    }

    const buckets = bucketsFrom(usage)
    const previous = state.last !== null
      && state.last.turn === turn
      && state.last.step === step
      ? state.last.buckets
      : undefined
    if (previous !== undefined && bucketsEqual(previous, buckets)) return state

    return {
      totals: addReplacing(state.totals, previous, buckets),
      last: { turn, step, buckets },
    }
  },
  wire: { viewSchema: projectionSchema, view: state => state.totals },
} satisfies ProjectionDefinition<'tokenUsage', TokenUsageState>

/**
 * Host-only model-call timeline used for cross-session usage reports.
 *
 * The first usage event fixes a sample's seq, step-start time, and route. A
 * later cumulative sample for the same turn and step replaces only its token
 * buckets, preserving the fork-deduplication and daily-grouping anchors.
 */
export const tokenUsageTimelineProjectionDefinition = {
  key: 'tokenUsageTimeline',
  stateVersion: 2,
  checkpoint: 'detach',
  stateSchema: tokenUsageTimelineStateSchema,
  init: (): TokenUsageTimelineState => ({
    route: { kind: 'unknown' },
    step: null,
    head: null,
  }),
  apply: (state, event) => {
    if (event.type === 'request/header') {
      const provider = event.data.header.config?.provider
      const model = event.data.header.config?.model
      const route: TokenUsageTimelineRoute = provider && model
        ? { kind: 'model', provider, model }
        : { kind: 'unknown' }
      if (state.route.kind === route.kind
        && (route.kind === 'unknown'
          || (state.route.kind === 'model'
            && state.route.provider === route.provider
            && state.route.model === route.model))) return state
      return { ...state, route }
    }
    if (event.type === 'step/start') {
      return { ...state, step: { ...event.data, time: event.time } }
    }
    if (event.type === 'step/end') {
      return state.step === null ? state : { ...state, step: null }
    }

    let turn: number
    let step: number
    let usage: TokenUsage
    if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
      ;({ turn, step } = event.data)
      usage = event.data.chunk.usage
    } else if (event.type === 'assistant/message' && event.data.usage !== undefined) {
      ;({ turn, step, usage } = event.data)
    } else {
      return state
    }

    const buckets = bucketsFrom(usage)
    const currentHead = state.head
    const latest = currentHead?.samples.at(-1)
    const previous = latest?.turn === turn && latest.step === step
      ? latest
      : undefined
    if (previous !== undefined && bucketsEqual(previous.buckets, buckets)) return state
    if (previous !== undefined && currentHead !== null) {
      const samples = [...currentHead.samples]
      samples[samples.length - 1] = { ...previous, buckets }
      return { ...state, head: { ...currentHead, samples } }
    }

    const time = state.step !== null
      && state.step.turn === turn
      && state.step.step === step
      ? state.step.time
      : event.time
    const sample = { seq: event.seq, time, turn, step, route: state.route, buckets }
    const head = state.head !== null && state.head.samples.length < TIMELINE_CHUNK_SIZE
      ? { ...state.head, samples: [...state.head.samples, sample] }
      : { samples: [sample], previous: state.head }
    return { ...state, head }
  },
} satisfies ProjectionDefinition<'tokenUsageTimeline', TokenUsageTimelineState>

/**
 * Token-meter's context-occupancy projection unit.
 *
 * Independent last-wins slots: the newest usage sample supplies the provider
 * numerator, the newest `request/context` record the denominator. Both are
 * whole values, so replay order alone decides the result and no cross-field
 * consistency is claimed — the pair is explicitly not one atomic request
 * observation (see {@link ContextPressureProjection}).
 *
 * `pressureTokens` is prompt-side only, so it holds still while a turn streams
 * and steps forward once the next request reports its usage. Because nothing
 * but a request reports usage, it also cannot see a compaction: the fold
 * therefore carries a running surface total alongside it and publishes
 * `projectedTokens` — the sample plus the surface's signed movement since it
 * was taken — so occupancy answers for the next request rather than the last
 * one. The total rides {@link foldSurfaceProjection}, so the state stays O(1)
 * and a replacement shrinks it by its logged shadow price. A replacement
 * without a claim preserves the previous total. A usage sample is stamped
 * BEFORE the same event joins the surface, so an `assistant/message` anchors
 * against the surface its own request saw.
 */
export const contextPressureProjectionDefinition = {
  key: 'contextPressure',
  stateVersion: 4,
  stateSchema: contextPressureStateSchema,
  init: () => ({ surfaceTokens: 0 }),
  apply: (state, event) => {
    const fold = foldSurfaceProjection(state.claim, event)
    let next = state
    if (event.type === 'request/context') {
      const contextWindow = event.data.contextWindow
      if (contextWindow !== state.contextWindow) {
        if (contextWindow !== undefined) {
          next = { ...next, contextWindow }
        } else {
          const { contextWindow: _removed, ...withoutContextWindow } = next
          next = withoutContextWindow
        }
      }
    }
    const usage = usageOf(event)
    if (usage !== undefined) {
      const pressureTokens = pressureFrom(usage)
      if (pressureTokens !== next.pressureTokens || next.sampledSurfaceTokens !== next.surfaceTokens) {
        next = { ...next, pressureTokens, sampledSurfaceTokens: next.surfaceTokens }
      }
    }
    if (fold.deltaTokens !== 0) {
      next = { ...next, surfaceTokens: next.surfaceTokens + fold.deltaTokens }
    }
    // A defined fold.claim is always freshly built, so presence decides claim
    // bookkeeping: no claim before or after this event leaves `next` as is.
    if (state.claim === undefined && fold.claim === undefined) return next
    const { claim: _expired, ...withoutClaim } = next
    return fold.claim === undefined ? withoutClaim : { ...withoutClaim, claim: fold.claim }
  },
  wire: {
    viewSchema: pressureSchema,
    view: ({ contextWindow, pressureTokens, surfaceTokens, sampledSurfaceTokens }) => ({
      ...contextWindow === undefined ? {} : { contextWindow },
      ...pressureTokens === undefined ? {} : { pressureTokens },
      ...pressureTokens === undefined || sampledSurfaceTokens === undefined
        ? {}
        : { projectedTokens: Math.max(0, pressureTokens + surfaceTokens - sampledSurfaceTokens) },
    }),
  },
} satisfies ProjectionDefinition<'contextPressure', ContextPressureState>
