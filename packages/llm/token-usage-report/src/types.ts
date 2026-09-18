/** Disjoint provider-reported token buckets. */
export interface TokenUsageBuckets {
  readonly uncachedInputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly outputTokens: number
}

/** Exact model route, or unknown when no request header preceded the usage. */
export type TokenUsageRoute =
  | { readonly kind: 'model'; readonly provider: string; readonly model: string }
  | { readonly kind: 'unknown' }

/** One requested-time-zone calendar day with per-route details. */
export interface TokenUsageDay {
  readonly date: string
  readonly buckets: TokenUsageBuckets
  readonly routes: readonly {
    readonly route: TokenUsageRoute
    readonly buckets: TokenUsageBuckets
  }[]
}

/** Point-in-time global usage report served to trusted clients. */
export interface TokenUsageReportSnapshot {
  readonly generatedAt: number
  readonly timeZone: string
  readonly window: { readonly from: string; readonly through: string; readonly days: 365 }
  readonly lifetime: TokenUsageBuckets
  readonly coverage: { readonly sessionCount: number; readonly failedSessionCount: number }
  readonly days: readonly TokenUsageDay[]
}

/** Browser request for one report grouped in an explicit IANA time zone. */
export interface TokenUsageReportRequest {
  readonly timeZone: string
}
