/** Token-usage refresh preference shared by the Host schema and browser controller. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the Token usage settings plugin. */
export const TOKEN_USAGE_SETTINGS_NAMESPACE = 'ui-token-usage'

/** Persisted refresh-interval field. */
export const REFRESH_INTERVAL_FIELD = 'refreshIntervalSeconds'

/** Refresh intervals exposed by the settings page. */
export const REFRESH_INTERVALS = [5, 10, 30, 60] as const

/** Supported refresh interval in seconds. */
export type RefreshIntervalSeconds = typeof REFRESH_INTERVALS[number]

/** Default report refresh interval. */
export const DEFAULT_REFRESH_INTERVAL_SECONDS: RefreshIntervalSeconds = 30

/** Durable preferences for the Token usage settings page. */
export interface TokenUsageSettings {
  /** Automatic report refresh interval in seconds. */
  refreshIntervalSeconds: RefreshIntervalSeconds
}

/** Wire and Host schema for Token usage preferences. */
export const TokenUsageSettingsSchema: z<TokenUsageSettings> = z.object({
  [REFRESH_INTERVAL_FIELD]: z.union([...REFRESH_INTERVALS]).default(DEFAULT_REFRESH_INTERVAL_SECONDS),
})

/**
 * Narrow a settings value to a supported refresh interval.
 * @param value - value read from the settings wire or UI control.
 * @returns whether the value is a supported interval.
 */
export function isRefreshIntervalSeconds(value: unknown): value is RefreshIntervalSeconds {
  return REFRESH_INTERVALS.some(interval => interval === value)
}
