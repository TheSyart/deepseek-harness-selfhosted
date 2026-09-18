# Token 计量

[English](token-meter.md) | 中文

`@deepseek-ai/dsh-token-meter` 公开一个独立的回放快照，用于表示请求压力与按位置计算的表层定价。`logRevision` 表示生成该计量中每个字段时所消费的持久事件数量。

来源：[`packages/llm/token-meter/src/types.ts`](../../packages/llm/token-meter/src/types.ts)

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

`baseline.kind === 'usage'` 表示最近一次成功的提供方调用具有相同的规范请求 envelope，且该调用的总量不低于其完整启发式锚点。`estimated` 表示不存在可复用的保守 usage 锚点，因此服务使用固定启发式规则对完整信封和表层定价。后续成功请求会替换早先的锚点；有符号的 `surfaceDeltaTokens` 会保留相对于匹配锚点的增长与缩减。`totalTokens` 仍表示请求与响应压力，`surfaceTokens` 则是仅针对表层的启发式总量，等于所有节点价格之和。

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

表层顺序具有权威性；替换节点的持久 seq 可能高于位置排在其后的节点。该快照不可变，不会随底层回放折叠推进而增长。

## Host 用量时间线

Host-only 时间线保留跨会话报告所需的最小归属信息，但不通过客户端投影帧暴露。用量之前存在请求标头时，路由是精确的；否则会明确标为未知。

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

反向链表头使用有界分块保存数据，使实时追加只改动局部分块，而 detach 检查点仍保留完整时间线。首次用量事件会固定每条样本的 seq、步骤开始时间与路由。同一 `(turn, step)` 的后续累计用量只替换其 bucket，包括请求随后失败的情况。消费方把首次 seq 与分叉的 `header.seedLength` 比较，使复制的父历史仍由原始会话拥有。

## 全局用量报告

Host 报告汇总已保存会话与实时会话的时间线。Lifetime 总量覆盖全部保留的用量；`days` 仅包含按浏览器请求的 IANA 时区划分、位于滚动 365 天窗口内的非空日期。覆盖情况会明确报告冷会话读取失败。

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

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [EpochHeader](session.zh.md) · [Message](llm-streaming.zh.md) · [Session](session.zh.md)

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
