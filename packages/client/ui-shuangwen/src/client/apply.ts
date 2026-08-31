/**
 * Shuangwen writing-mode plugin, browser half: the `shuangwen` dictionaries
 * plus the quick-action strip registered into the conversation-declared
 * input dock. Zero business face — every fact rides the framework hooks
 * (preset id via the sessions list, posture via the conversation snapshot,
 * staging and sending via the public input action face). Copy rides the
 * standard locale seat.
 * Export discipline: packages/client/AGENTS.md.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the conversation plugin's SlotMap merge (the dock hole).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ShuangwenDock } from './ShuangwenDock.tsx'
import { en, zh, type ShuangwenKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The shuangwen quick-action strip's copy. */
    shuangwen: ShuangwenKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'shuangwen'

/** Required services: the slot registry and the strip's copy. */
export const inject = ['slots', 'locale']

/**
 * Register the shuangwen dictionaries and the input-dock strip.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-shuangwen: dictionaries')

  // The dock hole is declared by ui-conversation; inject-wait so this
  // registration survives the declaration's own lifecycle.
  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register({
      name: 'conversation.input.dock',
      id: 'shuangwen',
      // Above the plan strip (order 0), so the writing controls stay first.
      order: -10,
      locale: NS,
    }, ShuangwenDock))
}
