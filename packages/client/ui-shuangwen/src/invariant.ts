/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-shuangwen`.
 * @module @deepseek-ai/dsh-client-ui-shuangwen/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-shuangwen'

/** Cordis companion plugin name. */
export const name = 'client-ui-shuangwen-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the dock is pure presentation over existing session
 * state (the roster-recorded preset id and the input machine) and produces no
 * model-visible, durable, or user-owned fact of its own — the slot
 * registration is an effect owned and observed by the slots registry.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
