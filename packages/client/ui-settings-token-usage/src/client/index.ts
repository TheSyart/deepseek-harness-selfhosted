/** Browser registration for the global Token usage settings page. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { TokenUsageReportController, type PollingEnvironment } from './controller.ts'
import { TokenUsageSection, type TokenUsageSectionInjected } from './TokenUsageSection.tsx'
import { en, zh, type TokenUsageKey } from './locales.ts'
import { TOKEN_USAGE_SETTINGS_NAMESPACE, type TokenUsageSettings } from '../token-usage-settings.ts'

export type {
  TokenUsageReportState,
  VisibilitySource,
} from './controller.ts'
export type {
  TokenUsageSectionInjected,
  TokenUsageSectionProps,
} from './TokenUsageSection.tsx'
export type { TokenUsageKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Global provider-reported Token usage page copy. */
    'settings.tokenUsage': TokenUsageKey
  }
}

/** Dictionary namespace owned by this page. */
export const NS = 'settings.tokenUsage'

/** Services required by the section, its settings scope, and generated Remote. */
export const inject = ['slots', 'locale', 'remote', 'remote.tokenUsageReport', 'settingsScope']

function browserEnvironment(): PollingEnvironment {
  return {
    visibility: {
      get hidden() { return typeof document !== 'undefined' && document.hidden },
      subscribe(listener) {
        if (typeof document === 'undefined') return () => {}
        document.addEventListener('visibilitychange', listener)
        return () => { document.removeEventListener('visibilitychange', listener) }
      },
    },
    setInterval: (callback, delay) => globalThis.setInterval(callback, delay),
    clearInterval: handle => globalThis.clearInterval(handle),
  }
}

/**
 * Register the localized Token usage settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-token-usage: dictionaries')
  const settings = ctx.settingsScope.bind<TokenUsageSettings>({
    namespace: TOKEN_USAGE_SETTINGS_NAMESPACE,
  })
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const controller = new TokenUsageReportController(
    async (request, signal) => {
      const result = await ctx.remote.tokenUsageReport.snapshot(request, signal)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    settings,
    timeZone,
    browserEnvironment(),
  )
  const t = ctx.locale.bind(NS) as TokenUsageSectionInjected['t']
  const injected = (): TokenUsageSectionInjected => ({
    controller,
    hooks: { snapshot: controller.store },
    t,
  })
  ctx.effect(() => () => controller.dispose(), 'ui-settings-token-usage: polling lifecycle')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'token-usage',
    order: 12,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, TokenUsageSection))
}
