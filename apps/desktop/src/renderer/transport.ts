/**
 * Renderer transport for the desktop shell: assembles the IPC bridge into
 * the fetch-shaped handler the connection carrier consumes, installs the
 * rewritten boot graph, and supplies the bundle loader the module system
 * uses instead of `<script src>` (file:// pages cannot fetch plugin bundles
 * over HTTP).
 * @module @deepseek-ai/dsh-desktop-app/transport
 */

import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
import * as clientModules from '@deepseek-ai/dsh-client-modules/client'
import type { ClientTransportHooks } from '@deepseek-ai/dsh-client-connection/client'
import type {
  ClientBundleRegistration,
  ClientModuleLoaderTarget,
  DshWindow,
} from '@deepseek-ai/dsh-client-modules/client'
import { InProcessApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type {
  DesktopBridgeApi,
  DesktopFetchPayload,
  DesktopStreamMessage,
} from '../desktop-api.ts'

/** Window global the connection plugin reads before selecting its platform carrier. */
const TRANSPORT_HOOKS_KEY = '__DSH_TRANSPORT__'

/** The in-process authority the apiproxy client resolves when the page origin is opaque (file://). */
const INTERNAL_HOST = 'dsh.internal'

/** Bootstrap package materialized directly by the desktop Vite shell. */
const CLIENT_MODULES_ID = '@deepseek-ai/dsh-client-modules'

/**
 * Install the registration facade that the web host normally injects into
 * HTML before its Vite entry. The desktop loads a static file, so it embeds
 * the same bootstrap module in its renderer bundle and leaves later client
 * packages to arrive through the IPC bundle loader.
 * @param win - Desktop renderer global carrying the module-loader facade.
 * @returns the installed queue-mode facade.
 */
export function installDesktopModuleLoader(win: DshWindow): ClientModuleLoaderTarget {
  if (win.__ModuleLoader__ !== undefined) {
    throw new Error('desktop transport: window.__ModuleLoader__ is already installed')
  }
  const pendingQueue: ClientBundleRegistration[] = []
  const target: ClientModuleLoaderTarget = {
    mode: 'queue',
    pendingQueue,
    load: registration => { pendingQueue.push(registration) },
    create: options => clientModules.createClientModuleSystem(target, {
      id: CLIENT_MODULES_ID,
      exports: { ...clientModules },
    }, options),
  }
  win.__ModuleLoader__ = target
  return target
}

/** Whether a request URL belongs to the harness transport and must ride the bridge. */
export function isInternalTransportUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    // The apiproxy client resolves its base to dsh.internal only when the
    // page origin serializes as the string 'null'; Chromium's file:// pages
    // report the origin 'file://' instead, so relative /api paths resolve to
    // file:///api/... and must ride the bridge all the same.
    if (parsed.hostname === INTERNAL_HOST) return true
    return parsed.protocol === 'file:' && parsed.pathname.startsWith('/api/')
  } catch {
    return false
  }
}

/** Encode a UTF-8 string as base64 (the bridge decodes request bodies with Buffer). */
export function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Decode one base64 stream chunk into bytes. */
export function base64Bytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** Collect fetch init headers into a plain record. */
function plainHeaders(init: RequestInit | undefined): Record<string, string> {
  const headers: Record<string, string> = {}
  const source = init?.headers
  if (source === undefined) return headers
  if (source instanceof Headers) {
    source.forEach((value, key) => { headers[key] = value })
    return headers
  }
  if (Array.isArray(source)) {
    for (const [key, value] of source) headers[key] = value
    return headers
  }
  Object.assign(headers, source)
  return headers
}

/** One adopted stream queue: buffered messages plus waiting stream pulls. */
interface StreamClaim {
  queue: DesktopStreamMessage[]
  waiters: Array<(message: DesktopStreamMessage) => void>
}

/**
 * Build the IPC-backed fetch the connection carrier consumes: requests to the
 * harness authority ride {@link DesktopBridgeApi.fetchTransport}, whose body
 * streams in as base64 chunks assembled into a ReadableStream. Abort signals
 * never cross IPC — the caller (InProcessApiClient) rejects locally and the
 * wrapper notifies the bridge once the stream id exists.
 *
 * The bridge starts pumping a response body as soon as the main-process fetch
 * resolves, which can precede this wrapper's receipt callback. A per-fetch
 * subscription registered after the receipt would therefore drop every
 * message sent in that gap, so the wrapper subscribes ONCE, up front, and
 * buffers messages per stream id until each receipt claims its queue.
 * @param desktop - the preload-exposed bridge.
 * @param originalFetch - the real fetch captured before this wrapper replaces it.
 * @returns a fetch-shaped function.
 */
export function createIpcFetch(desktop: DesktopBridgeApi, originalFetch: typeof fetch): typeof fetch {
  // Streams whose receipts have not resolved yet (messages arriving in the
  // receipt-in-flight gap); each queue is adopted by its receipt and the
  // entry removed. An abandoned fetch (aborted before its receipt) can leave
  // one bounded entry holding its trailing messages until process end.
  const unclaimed = new Map<string, DesktopStreamMessage[]>()
  const claimed = new Map<string, StreamClaim>()
  desktop.onStream((message) => {
    const claim = claimed.get(message.streamId)
    if (claim !== undefined) {
      const waiter = claim.waiters.shift()
      if (waiter === undefined) claim.queue.push(message)
      else waiter(message)
      return
    }
    const queue = unclaimed.get(message.streamId)
    if (queue === undefined) unclaimed.set(message.streamId, [message])
    else queue.push(message)
  })

  return (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!isInternalTransportUrl(url)) return originalFetch(input, init)
    const requestBody = init?.body
    let body: string | undefined
    if (requestBody === undefined || requestBody === null) {
      body = undefined
    } else if (typeof requestBody === 'string') {
      body = utf8Base64(requestBody)
    } else if (requestBody instanceof Uint8Array) {
      let binary = ''
      for (const byte of requestBody) binary += String.fromCharCode(byte)
      body = btoa(binary)
    } else {
      return Promise.reject(new TypeError('desktop transport: unsupported fetch body type'))
    }
    const payload: DesktopFetchPayload = {
      url,
      method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
      headers: plainHeaders(init),
      ...(body === undefined ? {} : { body }),
    }
    let streamId: string | undefined
    const callerSignal = init?.signal
    const abortStream = (): void => {
      if (streamId !== undefined) desktop.abort(streamId)
    }
    callerSignal?.addEventListener('abort', abortStream, { once: true })
    return desktop.fetchTransport(payload).then((receipt) => {
      streamId = receipt.streamId
      if (callerSignal?.aborted === true) desktop.abort(receipt.streamId)
      const claim: StreamClaim = { queue: unclaimed.get(receipt.streamId) ?? [], waiters: [] }
      unclaimed.delete(receipt.streamId)
      claimed.set(receipt.streamId, claim)
      const nextMessage = (): Promise<DesktopStreamMessage> => {
        const queued = claim.queue.shift()
        if (queued !== undefined) return Promise.resolve(queued)
        return new Promise((resolve) => { claim.waiters.push(resolve) })
      }
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const message = await nextMessage()
          if (message.kind === 'chunk') {
            controller.enqueue(base64Bytes(message.chunk))
          } else if (message.kind === 'end') {
            claimed.delete(receipt.streamId)
            controller.close()
          } else {
            claimed.delete(receipt.streamId)
            controller.error(new Error(message.message))
          }
        },
        cancel() {
          claimed.delete(receipt.streamId)
          desktop.abort(receipt.streamId)
        },
      })
      return new Response(stream, { status: receipt.status, headers: receipt.headers })
    })
  }
}

/**
 * Parse one bridge-minted bundle URL back into its entry id. Mirrors
 * `@deepseek-ai/dsh-desktop/bridge`'s `bundleIdFromUrl` (the URL format that
 * module mints).
 * @param url - the URL the module system hands to the bundle loader.
 * @returns the entry id, or undefined for any other URL shape.
 */
export function bundleIdFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'dsh-bundle:') return undefined
    const id = decodeURIComponent(parsed.pathname.slice(1))
    return id === '' ? undefined : id
  } catch {
    return undefined
  }
}

/** Load one plugin bundle as an inline classic script (file:// pages cannot fetch scripts). */
export function createBundleLoader(desktop: DesktopBridgeApi): (url: string) => Promise<void> {
  return async (url: string) => {
    const id = bundleIdFromUrl(url)
    if (id === undefined) throw new Error(`desktop transport: unexpected bundle URL ${JSON.stringify(url)}`)
    const text = await desktop.bundleText(id)
    const script = document.createElement('script')
    script.textContent = text
    document.head.appendChild(script)
  }
}

/**
 * Boot the desktop shell: read the rewritten boot graph from the bridge,
 * install the IPC fetch as the connection carrier (and as the page fetch for
 * the generic RPC channels), then run the web shell kernel with the IPC
 * bundle loader.
 * @param el - the app mount point (#root).
 */
export async function bootstrapDesktop(el: HTMLElement): Promise<void> {
  // The preload installs __DSH_DESKTOP__ before page scripts run; the
  // optional read keeps the guard honest for a failed preload.
  const desktop = (globalThis as { __DSH_DESKTOP__?: DesktopBridgeApi }).__DSH_DESKTOP__
  if (desktop === undefined) throw new Error('desktop app: the preload bridge (__DSH_DESKTOP__) is missing')
  const manifest = await desktop.bootGraph()
  const win = globalThis as DshWindow
  win.__DSH_BOOT__ = manifest
  installDesktopModuleLoader(win)
  const originalFetch = globalThis.fetch
  const ipcFetch = createIpcFetch(desktop, originalFetch)
  const transport: ClientTransportHooks = {
    createApiClient: () => new InProcessApiClient({ fetch: ipcFetch }),
    fetch: ipcFetch,
    localAuthority: true,
  }
  ;(globalThis as Record<string, unknown>)[TRANSPORT_HOOKS_KEY] = transport
  globalThis.fetch = ipcFetch
  await new AppWebEntry(el, { loadBundle: createBundleLoader(desktop) }).run()
}
