/** Host loader entry for the Token usage settings browser plugin. */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  TOKEN_USAGE_SETTINGS_NAMESPACE,
  TokenUsageSettingsSchema,
} from './token-usage-settings.ts'

/** Register the durable refresh preference when a settings provider exists. */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      settingsNamespace(TOKEN_USAGE_SETTINGS_NAMESPACE),
      TokenUsageSettingsSchema,
    )
  })
}

export type {
  RefreshIntervalSeconds,
  TokenUsageSettings,
} from './token-usage-settings.ts'
