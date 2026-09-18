# Token Meter

English | [中文](token-meter.zh.md)

`@deepseek-ai/dsh-token-meter` exposes one detached replay snapshot for request pressure and positional surface pricing. `logRevision` is the number of durable events consumed for every field in the measurement.

Source: [`packages/llm/token-meter/src/types.ts`](../../packages/llm/token-meter/src/types.ts)

## `TokenMeasurement`

```ts type-equiv
/** Detached immutable request-pressure and surface snapshot at one consumed log revision. */
interface TokenMeasurement {
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
```

`baseline.kind === 'usage'` means the latest successful provider call has the same canonical request envelope and its total is no lower than that call's full heuristic anchor. `estimated` means no reusable conservative usage anchor exists, so the service priced the complete envelope and surface with its fixed heuristic. A later successful request replaces the earlier anchor; signed `surfaceDeltaTokens` preserves growth and shrinkage relative to a matching anchor. `totalTokens` remains request-and-response pressure, while `surfaceTokens` is the surface-only heuristic total and equals the sum of the node prices.

## `TokenSurfaceNode`

```ts type-equiv
/** One token-priced node in the current ordered session surface. */
interface TokenSurfaceNode {
  /** Durable sequence number of the surface event. */
  readonly seq: number
  /** Heuristic tokens for the exact message projected by this node. */
  readonly tokens: number
}
```

Surface order is authoritative; replacement nodes can have higher durable seqs than later positional nodes. The snapshot is immutable and does not grow when the underlying replay fold advances.

## Host usage timeline

The Host-only timeline preserves the minimum attribution needed for cross-session reports without exposing it through client projection frames. Its route is exact when a request header precedes the usage and explicitly unknown otherwise.

```ts type-equiv
/** Exact provider route attached to one provider-reported usage sample. */
type TokenUsageTimelineRoute =
  | { readonly kind: 'model'; readonly provider: string; readonly model: string }
  | { readonly kind: 'unknown' }
```

```ts type-equiv
/** One model call's disjoint provider-reported token buckets. */
interface TokenUsageTimelineBuckets {
  readonly uncachedInputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}
```

```ts type-equiv
/** One model call retained by the Host-only timeline projection. */
interface TokenUsageTimelineSample {
  /** Seq of the first usage event reported for this turn and step. */
  readonly seq: number
  /** Millisecond timestamp of the matching `step/start` event. */
  readonly time: number
  readonly turn: number
  readonly step: number
  readonly route: TokenUsageTimelineRoute
  readonly buckets: TokenUsageTimelineBuckets
}
```

```ts type-equiv
/** Persistable Host-only state used to aggregate usage across saved sessions. */
interface TokenUsageTimelineState {
  readonly route: TokenUsageTimelineRoute
  readonly step: { readonly turn: number; readonly step: number; readonly time: number } | null
  readonly head: TokenUsageTimelineChunk | null
}
```

The reverse-linked head stores bounded chunks, keeping live appends local while detach checkpoints retain the complete timeline. The first usage event fixes each sample's seq, step-start time, and route. Later cumulative usage for the same `(turn, step)` replaces only its buckets, including when the request subsequently fails. Consumers compare the first seq with a fork's `header.seedLength` so copied parent history remains owned by the original session.

## Global usage report

The Host report aggregates the timeline across saved and live sessions. Lifetime totals cover all retained usage, while `days` contains non-empty dates within the rolling 365-day window in the browser-requested IANA time zone. Coverage reports cold-session failures explicitly.

```ts type-equiv
/** Disjoint provider-reported token buckets. */
interface TokenUsageBuckets {
  readonly uncachedInputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly outputTokens: number
}
```

```ts type-equiv
/** Exact model route, or unknown when no request header preceded the usage. */
type TokenUsageRoute =
  | { readonly kind: 'model'; readonly provider: string; readonly model: string }
  | { readonly kind: 'unknown' }
```

```ts type-equiv
/** One requested-time-zone calendar day with per-route details. */
interface TokenUsageDay {
  readonly date: string
  readonly buckets: TokenUsageBuckets
  readonly routes: readonly {
    readonly route: TokenUsageRoute
    readonly buckets: TokenUsageBuckets
  }[]
}
```

```ts type-equiv
/** Point-in-time global usage report served to trusted clients. */
interface TokenUsageReportSnapshot {
  readonly generatedAt: number
  readonly timeZone: string
  readonly window: { readonly from: string; readonly through: string; readonly days: 365 }
  readonly lifetime: TokenUsageBuckets
  readonly coverage: { readonly sessionCount: number; readonly failedSessionCount: number }
  readonly days: readonly TokenUsageDay[]
}
```

```ts type-equiv
/** Browser request for one report grouped in an explicit IANA time zone. */
interface TokenUsageReportRequest {
  readonly timeZone: string
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtokenmeter--tokenmeter"></a>

### `ctx.tokenMeter` — `TokenMeter`

Replay owner for one service-wide estimator and isolated per-session folds.

```ts cordis-catalog
/**
 * Measure current request pressure and surface through the durable tail.
 *
 * Provider usage is reused only when the latest successful call's canonical
 * request envelope matches `requestHeader` and its total is no lower than
 * that call's full heuristic anchor; otherwise the complete envelope and
 * surface are heuristically repriced.
 *
 * `requestHeader` affects request pressure only; surface fields always
 * describe the current session surface. Every call clones those positional
 * nodes, so measurement is O(surface).
 *
 * @param session - session to replay through its current durable tail.
 * @param requestHeader - optional effective request envelope replacing the latest logged header.
 * @returns a detached deeply immutable pressure and surface measurement.
 */
measure(session: Session, requestHeader?: EpochHeader): TokenMeasurement

/**
 * Heuristically price one model-visible message (instance face of the pure
 * `estimateMessage` export from `estimate.ts`).
 * @param message - message to price without mutation.
 * @returns content and role-framing tokens under the fixed service heuristic.
 */
estimateMessage(message: Message): number
```

Types: [EpochHeader](session.md) · [Message](llm-streaming.md) · [Session](session.md)

Source: [`packages/llm/token-meter/src/index.ts`](../../packages/llm/token-meter/src/index.ts)

<a id="ctxtokenusagereport--tokenusagereportservice"></a>

### `ctx.tokenUsageReport` — `TokenUsageReportService`

Host Remote that merges live and persisted session usage.

```ts cordis-catalog
/**
 * Merge every persisted and live session into one provider-usage report.
 * A live session supersedes the same persisted id. Cold failures exclude
 * only that session and increment coverage; listing and cancellation
 * failures reject the whole request.
 * @param request - IANA time zone used for calendar-day grouping.
 * @param signal - optional caller cancellation.
 * @returns global lifetime and rolling-365-day usage.
 */
@Remote('snapshot') async snapshot( request: TokenUsageReportRequest, signal?: AbortSignal, ): Promise<TokenUsageReportSnapshot>
```

Source: [`packages/llm/token-usage-report/src/index.ts`](../../packages/llm/token-usage-report/src/index.ts)
<!-- END GENERATED cordis-surface -->
