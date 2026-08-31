/**
 * @deepseek-ai/dsh-desktop — the Electron desktop surface's runtime glue
 * plugin plus the bundle patch (`cordis.patch.yml`, declared by the
 * `dsh.bundle.patch` manifest field). The plugin owns the desktop-surface
 * glue: it provides the composition-satisfying `webServer` facade (the
 * desktop profile serves no HTTP — renderer traffic rides the IPC bridge in
 * `./startup.ts`) and registers the model-visible desktop surface prompt
 * section.
 * @module @deepseek-ai/dsh-desktop
 */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { addHarnessSourceSection } from '@deepseek-ai/dsh-app-boot'
import type { WebRoute, WebUpgradeRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Stable Cordis plugin name. */
export const name = 'desktop-runtime'

/** This dsh installation's root, from either this package's source or built entry. */
const SOURCE_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** Plugin config: composed deployment settings. */
export interface Config {
  /**
   * Register the model-visible surface context (the `app:desktop-surface`
   * prompt section). A deployment composing the desktop rows without a GUI
   * user can turn it off, so the orientation text would be false.
   */
  surfaceContext: boolean
}

export const Config: z<Config> = z.object({
  surfaceContext: z.boolean().default(true),
})

/**
 * Composition-satisfying `webServer` slot for the desktop profile. The
 * desktop profile mounts rows that bind transport to `webServer` — the
 * client-modules node half registers its `/plugins` route and index tap, the
 * connection node half registers its `/api` route and downlink upgrades —
 * but the desktop surface serves those paths over the IPC bridge instead of
 * HTTP. The facade accepts those registrations so the rows compose
 * unchanged; its members that would report server facts fail loud because no
 * server exists. The `register`/`tapIndex` members exist for the mounted
 * rows, not for future HTTP use; a profile that actually serves HTTP should
 * mount the real webserver row.
 */
export class DesktopWebServerFacade {
  /** Index transforms registered by mounted rows (the modules node half's boot-manifest tap). */
  private readonly taps: Array<(html: string) => string> = []

  /** The desktop profile binds no interfaces; loopback is the honest composition fact. */
  get host(): '127.0.0.1' {
    return '127.0.0.1'
  }

  /** No HTTP server exists in the desktop profile, so no port exists to report. */
  get port(): number {
    throw new Error('desktop facade: the desktop profile serves no HTTP; there is no port')
  }

  /**
   * Accept one route registration without serving it: the desktop carrier
   * (the IPC bridge) serves the mounted rows' paths.
   * @param _route - the route the mounted row registers, accepted and not served.
   * @returns a no-op disposer.
   */
  register(_route: WebRoute): () => void {
    return () => {}
  }

  /**
   * Accept one upgrade-route registration without serving it: the desktop
   * downlink streams ride the apiproxy SSE codec over the IPC bridge.
   * @param _route - the upgrade route the mounted row registers, accepted and not served.
   * @returns a no-op disposer.
   */
  registerUpgrade(_route: WebUpgradeRoute): () => void {
    return () => {}
  }

  /**
   * The HTTP fallback seat has no meaning without a server; claiming it in a
   * desktop composition is a misconfiguration and fails loud.
   * @param _handler - the fallback handler the caller attempted to claim with, never installed.
   * @returns never — the call always throws.
   * @throws always — the desktop profile serves no HTTP fallback seat.
   */
  registerFallback(_handler: WebRoute['handler']): () => void {
    throw new Error('desktop facade: the desktop profile serves no HTTP; there is no fallback seat')
  }

  /**
   * Accept one index transform for {@link applyIndexTaps} (the modules node
   * half's boot-manifest injection tap; the desktop app applies it when it
   * renders its own index).
   * @param transform - html-to-html transform.
   * @returns the removal disposer.
   */
  tapIndex(transform: (html: string) => string): () => void {
    this.taps.push(transform)
    return () => {
      const index = this.taps.indexOf(transform)
      if (index !== -1) this.taps.splice(index, 1)
    }
  }

  /**
   * Run a body through the registered index transforms in registration order.
   * @param html - the index body before transforms.
   * @returns the body after every registered transform.
   */
  applyIndexTaps(html: string): string {
    let result = html
    for (const transform of this.taps) result = transform(result)
    return result
  }
}

/** Model-visible orientation for sessions created through the desktop app. */
function desktopSurfacePrompt(): string {
  return 'You are interacting with the user through the DeepSeek Harness desktop app (Electron). '
    + 'When the user refers to "this app", "this window", "this page", or "this GUI" without naming another target, they mean this desktop app. '
    + 'The window provides no implicit DOM, route, or screenshot context. '
    + 'The desktop app carries the harness transport over an in-process IPC bridge and listens on no HTTP port. '
    + 'Do not start a replacement server; if one is needed, use a managed background job and verify its exact URL.'
}

/**
 * Mount the desktop runtime: the webServer composition facade and the
 * desktop surface prompt section.
 * @param ctx - plugin context.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  // The Context merge types this slot as the real webserver; the facade is
  // the desktop profile's deliberate stand-in (see its class contract).
  ctx.provide('webServer', new DesktopWebServerFacade() as unknown as WebServer)
  if (config.surfaceContext) {
    ctx.inject(['systemPrompt'], (promptCtx) => {
      addHarnessSourceSection(promptCtx, SOURCE_ROOT)
      promptCtx.systemPrompt.section({
        name: 'app:desktop-surface',
        order: -98,
        text: () => desktopSurfacePrompt(),
      })
    })
  }
}
