/**
 * The Electron IPC bridge for the desktop profile (`@deepseek-ai/dsh-desktop/startup`):
 * serves the renderer's wire traffic — /api-shaped fetch (unary RPC plus the
 * apiproxy SSE-codec downlink streams), plugin bundles, and the client boot
 * graph — over `ipcMain` channels, so the desktop surface listens on no HTTP
 * port. The bridge is gated on the `desktopStartup` service the app assembly
 * provides (see the bundle patch), and every `ipcMain` registration disposes
 * with the plugin fiber.
 *
 * The pure core (`rewriteGraph`, `bundleIdFromUrl`, `pumpResponseBody`) keeps
 * no Electron imports, so it is unit-testable under plain Node.
 * @module @deepseek-ai/dsh-desktop/startup
 */

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import type { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { WebBootGraph } from '@deepseek-ai/dsh-client-modules'

/** Stable Cordis plugin name. */
export const name = 'desktop-bridge'

/** Services the bridge binds before it can serve the renderer. */
export const inject = ['desktopStartup', 'clientModules', 'apiProxy', 'connection']

/** IPC channel: renderer fetch request (invoke → receipt, then stream messages). */
export const FETCH_CHANNEL = 'dsh-desktop:fetch'
/** IPC channel: renderer aborts one open fetch stream. */
export const ABORT_CHANNEL = 'dsh-desktop:abort'
/** IPC channel: main-process stream body messages to the renderer. */
export const STREAM_CHANNEL = 'dsh-desktop:stream'
/** IPC channel: renderer reads the client boot graph. */
export const BOOT_GRAPH_CHANNEL = 'dsh-desktop:boot-graph'
/** IPC channel: renderer reads one plugin client bundle. */
export const BUNDLE_CHANNEL = 'dsh-desktop:bundle'

/** Minimal Electron event surface the bridge consumes. */
export interface IpcEventLike {
  /** The sender's frame (null when the sender has no frame). */
  readonly senderFrame: { readonly url: string } | null
  /** The sender's WebContents surface, used to push stream messages. */
  readonly sender: { send(channel: string, ...args: unknown[]): void }
}

/** Minimal Electron ipcMain surface the bridge registers on. */
export interface IpcMainLike {
  /** Register a request/response channel handler. */
  handle(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => unknown): void
  /** Register a fire-and-forget channel listener. */
  on(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => void): void
  /** Remove one handle registration. */
  removeHandler(channel: string): void
  /** Remove one fire-and-forget listener. */
  removeListener(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => void): void
}

/** What the app assembly provides as `desktopStartup`: the Electron surface and the sender fence. */
export interface DesktopStartupValues {
  /** The Electron ipcMain surface (the app owns the module import; the bridge stays dependency-free). */
  ipcMain: IpcMainLike
  /** Trust fence: returns true only for the main window's top-level frame on this app's dist URL. */
  validateSender: (event: IpcEventLike) => boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Provided by the desktop app assembly before boot; gates the bridge row. */
    desktopStartup: DesktopStartupValues
  }
}

/** The renderer's fetch request payload (the bridge is a wire boundary and narrows it field by field). */
export interface DesktopFetchRequest {
  url: string
  method: string
  headers: Record<string, string>
  /** Request body, base64-encoded (signals never cross the wire; the caller owns abort). */
  body?: string
}

/** The invoke receipt: response envelope plus the stream identity for body chunks. */
export interface DesktopFetchReceipt {
  streamId: string
  status: number
  headers: Record<string, string>
}

/** One main→renderer stream message (the STREAM_CHANNEL payload). */
export type DesktopStreamMessage =
  | { readonly streamId: string; readonly kind: 'chunk'; readonly chunk: string }
  | { readonly streamId: string; readonly kind: 'end' }
  | { readonly streamId: string; readonly kind: 'error'; readonly message: string }

/**
 * Rewrite the composed client graph for the IPC carrier: each bundle URL
 * becomes `dsh-bundle:///<id>?rev=<rev>`, which the desktop app's
 * `loadBundle` override resolves through {@link BUNDLE_CHANNEL}.
 * @param graph - the graph the client-modules node half composed.
 * @returns the same graph with IPC-scheme bundle URLs.
 */
export function rewriteGraph(graph: WebBootGraph): WebBootGraph {
  return {
    ...graph,
    entries: graph.entries.map(entry => ({
      ...entry,
      url: `dsh-bundle:///${entry.id}?rev=${entry.rev}`,
    })),
  }
}

/**
 * Parse one rewritten bundle URL back into its entry id.
 * @param url - the URL the module system hands to `loadBundle`.
 * @returns the entry id, or undefined for any other URL shape.
 */
export function bundleIdFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'dsh-bundle:') return undefined
    const id = decodeURIComponent(parsed.pathname.slice(1))
    return id === '' ? undefined : id
  } catch {
    // Not a URL at all: the desktop loadBundle only accepts rewritten rows.
    return undefined
  }
}

/**
 * Pump one fetch response body into stream messages until it ends, the
 * caller aborts, or the read fails. The renderer assembles these messages
 * back into a ReadableStream; abort cancels the reader (pending reads reject)
 * and the pump then ends silently because the renderer has already rejected
 * its side.
 * @param body - the response body stream.
 * @param onChunk - receives one base64 body chunk.
 * @param onEnd - called when the stream ends cleanly.
 * @param onError - called with the failure message when the read fails un-aborted.
 * @param signal - the stream's abort signal.
 */
export async function pumpResponseBody(
  body: ReadableStream<Uint8Array>,
  onChunk: (base64: string) => void,
  onEnd: () => void,
  onError: (message: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader()
  const abortStop = (): void => {
    /* v8 ignore next 2 -- a cancel on an already-settled reader rejects; that rejection carries no action */
    void reader.cancel('stream aborted').catch(() => {})
  }
  signal.addEventListener('abort', abortStop, { once: true })
  try {
    while (true) {
      if (signal.aborted) return
      const { done, value } = await reader.read()
      if (done) {
        onEnd()
        return
      }
      onChunk(Buffer.from(value).toString('base64'))
    }
  } catch (error) {
    // Named swallow: the failure reaches the renderer as a stream error
    // message unless the abort already ended the stream there. An abort
    // settles the in-flight read as done, so the guard below only covers
    // engine-specific cancel rejections racing the abort listener.
    /* v8 ignore next 3 -- abort settles the in-flight read as done; the guard silences a racing rejection for a cancelled renderer */
    if (!signal.aborted) onError(error instanceof Error ? error.message : String(error))
  } finally {
    signal.removeEventListener('abort', abortStop)
  }
}

/**
 * Assemble the receipt for one fetch response and start its body pump; a
 * null body ends the stream immediately. Extracted so the null-body arm is
 * reachable in unit tests (the apiproxy handler always answers with a body).
 * @param streamId - the stream identity shared by receipt and stream messages.
 * @param response - the response to serve.
 * @param send - pushes one stream message to the renderer.
 * @param signal - the stream's abort signal.
 * @param onSettled - runs once the body pump settles (or immediately for a null body).
 * @returns the invoke receipt.
 */
export function beginStream(
  streamId: string,
  response: Response,
  send: (message: DesktopStreamMessage) => void,
  signal: AbortSignal,
  onSettled: () => void,
): DesktopFetchReceipt {
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => { headers[key] = value })
  if (response.body === null) {
    send({ streamId, kind: 'end' })
    onSettled()
    return { streamId, status: response.status, headers }
  }
  void pumpResponseBody(
    response.body,
    (chunk) => { send({ streamId, kind: 'chunk', chunk }) },
    () => { send({ streamId, kind: 'end' }) },
    (message) => { send({ streamId, kind: 'error', message }) },
    signal,
  ).then(onSettled, onSettled)
  return { streamId, status: response.status, headers }
}

/** Narrow one untrusted invoke payload to {@link DesktopFetchRequest}. */
function readFetchRequest(value: unknown): DesktopFetchRequest {
  if (typeof value !== 'object' || value === null) {
    throw new Error('desktop-bridge: fetch request must be an object')
  }
  const record = value as Record<string, unknown>
  if (typeof record.url !== 'string') throw new Error('desktop-bridge: fetch request url must be a string')
  const method = record.method === undefined ? 'GET' : record.method
  if (typeof method !== 'string') throw new Error('desktop-bridge: fetch request method must be a string')
  const headers: Record<string, string> = {}
  if (record.headers !== undefined) {
    if (typeof record.headers !== 'object' || record.headers === null) {
      throw new Error('desktop-bridge: fetch request headers must be an object')
    }
    for (const [key, header] of Object.entries(record.headers as Record<string, unknown>)) {
      if (typeof header !== 'string') throw new Error('desktop-bridge: fetch request header values must be strings')
      headers[key] = header
    }
  }
  let body: string | undefined
  if (record.body !== undefined) {
    if (typeof record.body !== 'string') throw new Error('desktop-bridge: fetch request body must be a base64 string')
    body = record.body
  }
  return { url: record.url, method, headers, ...(body === undefined ? {} : { body }) }
}

/** Narrow one untrusted message payload to a bundle id. */
function readBundleId(value: unknown): string {
  if (typeof value !== 'object' || value === null || typeof (value as Record<string, unknown>).id !== 'string') {
    throw new Error('desktop-bridge: bundle request must carry a string id')
  }
  return (value as { id: string }).id
}

/** Narrow one untrusted message payload to a stream id. */
function readStreamId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const id = (value as Record<string, unknown>).streamId
  return typeof id === 'string' ? id : undefined
}

/**
 * Mount the bridge: register the five IPC channels with sender validation
 * and effect-scoped disposal. A fetch response body pumps as base64 stream
 * messages; the request body arrives base64-encoded because Electron IPC
 * serializes the structured clone, never an AbortSignal.
 * @param ctx - plugin context carrying `desktopStartup`, `clientModules`, and `apiProxy`.
 */
export function apply(ctx: Context): void {
  const startup = ctx.get('desktopStartup')
  // The bundle patch gates this row on the service; reaching apply without it
  // is a miscomposition, and the desktop surface has no Electron to serve.
  if (startup === undefined) throw new Error('desktop-bridge: desktopStartup service is missing')
  const { ipcMain, validateSender } = startup
  // The connection node half's concrete service carries the interceptor chain
  // (Typert Remotes like pluginInventory/list) ahead of the apiproxy fallback —
  // the same handler order the web /api route uses. The Context merge types
  // the slot as the handle interface; the desktop profile always mounts the
  // concrete HostConnectionService.
  const connection = ctx.get('connection') as HostConnectionService | undefined
  if (connection === undefined) throw new Error('desktop-bridge: the connection service is missing')
  const fetchHandler = connection.createSharedFetchHandler('/api', {
    // The desktop downlink streams ride the apiproxy SSE codec; the
    // interceptor chain has no claim on them, and no WebSocket upgrade
    // exists over IPC, so the fallback answers everything the interceptors
    // do not claim.
    async fetch(request) {
      return toFetchHandler(ctx.apiProxy).fetch(request)
    },
  })
  const streams = new Map<string, AbortController>()

  const assertSender = (event: IpcEventLike): void => {
    if (!validateSender(event)) {
      throw new Error('desktop-bridge: refusing an IPC request from an untrusted sender')
    }
  }

  const handleFetch = async (event: IpcEventLike, ...args: unknown[]): Promise<DesktopFetchReceipt> => {
    assertSender(event)
    const payload = readFetchRequest(args[0])
    const controller = new AbortController()
    const streamId = randomUUID()
    streams.set(streamId, controller)
    const response = await fetchHandler.fetch(new Request(payload.url, {
      method: payload.method,
      headers: payload.headers,
      ...payload.body === undefined ? {} : { body: Buffer.from(payload.body, 'base64') },
      signal: controller.signal,
    }))
    return beginStream(
      streamId,
      response,
      (message) => { event.sender.send(STREAM_CHANNEL, message) },
      controller.signal,
      () => { streams.delete(streamId) },
    )
  }

  const handleAbort = (event: IpcEventLike, ...args: unknown[]): void => {
    // A fire-and-forget listener has no rejection surface: an untrusted
    // sender simply cannot abort a stream it never opened.
    if (!validateSender(event)) return
    const streamId = readStreamId(args[0])
    if (streamId !== undefined) streams.get(streamId)?.abort()
  }

  const handleBootGraph = (event: IpcEventLike): WebBootGraph => {
    assertSender(event)
    return rewriteGraph(ctx.clientModules.graph())
  }

  const handleBundle = async (event: IpcEventLike, ...args: unknown[]): Promise<string> => {
    assertSender(event)
    const id = readBundleId(args[0])
    const path = ctx.clientModules.clientPath(id)
    if (path === undefined) {
      throw new Error(`desktop-bridge: no client bundle is registered for ${JSON.stringify(id)}`)
    }
    return readFile(path, 'utf8')
  }

  ipcMain.handle(FETCH_CHANNEL, handleFetch)
  ipcMain.on(ABORT_CHANNEL, handleAbort)
  ipcMain.handle(BOOT_GRAPH_CHANNEL, handleBootGraph)
  ipcMain.handle(BUNDLE_CHANNEL, handleBundle)
  ctx.effect(() => () => {
    for (const controller of streams.values()) controller.abort()
    streams.clear()
    ipcMain.removeHandler(FETCH_CHANNEL)
    ipcMain.removeHandler(BOOT_GRAPH_CHANNEL)
    ipcMain.removeHandler(BUNDLE_CHANNEL)
    ipcMain.removeListener(ABORT_CHANNEL, handleAbort)
  })
}
