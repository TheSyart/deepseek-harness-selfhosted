/**
 * Desktop bridge: pure core (graph rewrite, bundle id parsing, stream
 * pumping) and the ipcMain registration layer — sender fence, fetch routing
 * through the apiproxy handler, streaming receipts, abort, boot graph,
 * bundle reads, and disposal.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import type { WebBootGraph } from '@deepseek-ai/dsh-client-modules'
import {
  ABORT_CHANNEL,
  apply,
  beginStream,
  BOOT_GRAPH_CHANNEL,
  BUNDLE_CHANNEL,
  bundleIdFromUrl,
  type DesktopFetchReceipt,
  type DesktopStreamMessage,
  type IpcEventLike,
  type IpcMainLike,
  FETCH_CHANNEL,
  pumpResponseBody,
  rewriteGraph,
  STREAM_CHANNEL,
} from '../src/startup.ts'

const GRAPH: WebBootGraph = {
  rev: 'graph-rev',
  entries: [
    { id: '@deepseek-ai/dsh-client-ui-theme', url: '/plugins/@deepseek-ai/dsh-client-ui-theme/client.js?rev=abc', rev: 'abc', immediately: true },
    { id: '@deepseek-ai/dsh-client-runtime', url: '/plugins/@deepseek-ai/dsh-client-runtime/client.js?rev=def', rev: 'def', inject: ['@deepseek-ai/dsh-client-connection'] },
  ],
}

/** A fake ipcMain that captures registrations per channel. */
class FakeIpcMain implements IpcMainLike {
  readonly handlers = new Map<string, (event: IpcEventLike, ...args: unknown[]) => unknown>()
  readonly listeners = new Map<string, (event: IpcEventLike, ...args: unknown[]) => void>()
  readonly removedHandlers: string[] = []
  readonly removedListeners: string[] = []

  handle(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, listener)
  }

  on(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => void): void {
    this.listeners.set(channel, listener)
  }

  removeHandler(channel: string): void {
    this.removedHandlers.push(channel)
    this.handlers.delete(channel)
  }

  removeListener(channel: string, _listener: (event: IpcEventLike, ...args: unknown[]) => void): void {
    this.removedListeners.push(channel)
    this.listeners.delete(channel)
  }
}

/** A fake sender event collecting stream-channel messages. */
class FakeEvent implements IpcEventLike {
  readonly streamMessages: DesktopStreamMessage[] = []

  constructor(
    readonly url = 'file:///app/dist/index.html',
    readonly trusted = true,
  ) {}

  get senderFrame(): { url: string } | null {
    return { url: this.url }
  }

  get sender(): { send(channel: string, ...args: unknown[]): void } {
    return {
      send: (channel, ...args) => {
        if (channel === STREAM_CHANNEL) this.streamMessages.push(args[0] as DesktopStreamMessage)
      },
    }
  }
}

/** A host.describe-serving stub ApiProxy (the one method the fetch tests dispatch). */
const stubApi = {
  host: {
    describe: async (request: { rpcId: string }) => ({
      rpcId: request.rpcId,
      result: { ok: true as const, value: { version: 'test', cwd: '/tmp', attachedSessions: 0, canOpenPath: false } },
    }),
  },
} as unknown as ApiProxy

/** Fake clientModules serving the boot graph and one bundle path. */
function fakeClientModules(bundlePath: string): { graph(): WebBootGraph; clientPath(id: string): string | undefined } {
  return {
    graph: () => GRAPH,
    clientPath: id => (id === '@deepseek-ai/dsh-client-ui-theme' ? bundlePath : undefined),
  }
}

/**
 * Fake connection service: the shared fetch handler routes through the
 * claimed endpoint when one matches, else through the caller's fallback —
 * the interceptor-chain shape the real HostConnectionService provides.
 */
function fakeConnection(claims: Readonly<Record<string, (request: Request) => Promise<Response>>>): {
  createSharedFetchHandler(channel: string, fallback: { fetch: typeof fetch }): { fetch: typeof fetch }
} {
  return {
    createSharedFetchHandler: (channel, fallback) => ({
      fetch: (input) => {
        const request = input instanceof Request ? input : new Request(input)
        const pathname = new URL(request.url).pathname
        const prefix = `${channel}/`
        if (!pathname.startsWith(prefix)) return fallback.fetch(request)
        const claimed = claims[pathname.slice(prefix.length)]
        return claimed === undefined ? fallback.fetch(request) : claimed(request)
      },
    }),
  }
}

function base64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64')
}

async function mount(options: {
  trusted?: boolean
  bundlePath?: string
  claims?: Readonly<Record<string, (request: Request) => Promise<Response>>>
} = {}): Promise<{
  ctx: Context
  ipc: FakeIpcMain
  event: FakeEvent
}> {
  const ctx = new Context()
  const ipc = new FakeIpcMain()
  const bundlePath = options.bundlePath ?? '/missing-bundle.js'
  ctx.provide('desktopStartup', {
    ipcMain: ipc,
    validateSender: event => options.trusted !== false && event.senderFrame?.url.startsWith('file:///app/') === true,
  })
  ctx.provide('clientModules', fakeClientModules(bundlePath) as never)
  ctx.provide('apiProxy', stubApi)
  ctx.provide('connection', fakeConnection(options.claims ?? {}) as never)
  apply(ctx)
  return { ctx, ipc, event: new FakeEvent() }
}

describe('pure core', () => {
  it('rewrites every bundle URL to the IPC scheme and keeps the row facts', () => {
    expect(rewriteGraph(GRAPH)).toEqual({
      rev: 'graph-rev',
      entries: [
        { id: '@deepseek-ai/dsh-client-ui-theme', url: 'dsh-bundle:///@deepseek-ai/dsh-client-ui-theme?rev=abc', rev: 'abc', immediately: true },
        { id: '@deepseek-ai/dsh-client-runtime', url: 'dsh-bundle:///@deepseek-ai/dsh-client-runtime?rev=def', rev: 'def', inject: ['@deepseek-ai/dsh-client-connection'] },
      ],
    })
  })

  it('parses rewritten bundle URLs back to ids and rejects other shapes', () => {
    expect(bundleIdFromUrl('dsh-bundle:///@deepseek-ai/dsh-client-ui-theme?rev=abc')).toBe('@deepseek-ai/dsh-client-ui-theme')
    expect(bundleIdFromUrl('https://example/plugins/x/client.js')).toBeUndefined()
    expect(bundleIdFromUrl('not-a-url')).toBeUndefined()
    expect(bundleIdFromUrl('dsh-bundle:///?rev=1')).toBeUndefined()
  })

  it('pumps chunks until the stream ends', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('hello'))
        controller.enqueue(new TextEncoder().encode(' world'))
        controller.close()
      },
    })
    const chunks: string[] = []
    await pumpResponseBody(body, chunk => chunks.push(chunk), () => { chunks.push('end') }, (message) => { chunks.push(`error:${message}`) }, new AbortController().signal)
    expect(chunks).toEqual([base64('hello'), base64(' world'), 'end'])
  })

  it('reports a mid-stream failure as an error message', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error('reader broke')
      },
    })
    const seen: string[] = []
    await pumpResponseBody(body, chunk => seen.push(chunk), () => seen.push('end'), message => seen.push(`error:${message}`), new AbortController().signal)
    expect(seen).toEqual(['error:reader broke'])
  })

  it('stops silently when the stream is aborted', async () => {
    const body = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) })
    const controller = new AbortController()
    const seen: string[] = []
    controller.abort()
    await pumpResponseBody(body, chunk => seen.push(chunk), () => seen.push('end'), message => seen.push(message), controller.signal)
    expect(seen).toEqual([])
  })

  it('resolves a mid-read abort as the stream end (reader cancel settles the pending read)', async () => {
    const body = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) })
    const controller = new AbortController()
    const seen: string[] = []
    const pumping = pumpResponseBody(body, chunk => seen.push(chunk), () => seen.push('end'), message => seen.push(message), controller.signal)
    controller.abort()
    await expect(pumping).resolves.toBeUndefined()
    // The pending read settles as done after cancel; the renderer already
    // cancelled its side, so the trailing end message is harmless.
    expect(seen).toEqual(['end'])
  })

  it('ends a null-body response immediately through beginStream', () => {
    const response = new Response(null, { status: 204, headers: { 'x-test': 'present' } })
    const messages: DesktopStreamMessage[] = []
    const settled: string[] = []
    const receipt = beginStream('null-body', response, message => messages.push(message), new AbortController().signal, () => settled.push('settled'))
    expect(receipt).toEqual({ streamId: 'null-body', status: 204, headers: { 'x-test': 'present' } })
    expect(messages).toEqual([{ streamId: 'null-body', kind: 'end' }])
    expect(settled).toEqual(['settled'])
  })

  it('reports a mid-stream read failure as an error message and still settles', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error('body broke')
      },
    })
    const response = new Response(body, { status: 200 })
    const messages: DesktopStreamMessage[] = []
    const settled: string[] = []
    const receipt = beginStream('failing', response, message => messages.push(message), new AbortController().signal, () => settled.push('settled'))
    expect(receipt.status).toBe(200)
    await vi.waitFor(() => { expect(settled).toEqual(['settled']) })
    expect(messages).toEqual([{ streamId: 'failing', kind: 'error', message: 'body broke' }])
  })
})

describe('bridge ipcMain layer', () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('fails loud when the desktopStartup service is absent', () => {
    const ctx = new Context()
    expect(() => { apply(ctx) }).toThrow(/desktopStartup service is missing/)
  })

  it('fails loud when the connection service is absent', () => {
    const ctx = new Context()
    ctx.provide('desktopStartup', { ipcMain: new FakeIpcMain(), validateSender: () => true })
    expect(() => { apply(ctx) }).toThrow(/connection service is missing/)
  })

  it('routes a claimed Remote endpoint through the connection interceptor chain', async () => {
    const claims = {
      'pluginInventory/list': async () => Response.json({ intercepted: true }),
    }
    const { ctx, ipc, event } = await mount({ claims })
    const handler = ipc.handlers.get(FETCH_CHANNEL)!
    const message = JSON.stringify({ type: 'client-request', rpcId: 'remote-test', method: 'pluginInventory/list', payload: {} })
    const receipt = await handler(event, {
      url: 'http://dsh.internal/api/pluginInventory/list',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: base64(message),
    }) as DesktopFetchReceipt
    expect(receipt.status).toBe(200)
    await vi.waitFor(() => { expect(event.streamMessages.at(-1)).toMatchObject({ kind: 'end' }) })
    const text = event.streamMessages
      .filter((m): m is Extract<DesktopStreamMessage, { kind: 'chunk' }> => m.kind === 'chunk')
      .map(m => Buffer.from(m.chunk, 'base64').toString('utf8'))
      .join('')
    expect(JSON.parse(text)).toEqual({ intercepted: true })
    await ctx.fiber.dispose()
  })

  it('routes a unary fetch through the apiproxy handler and streams the body', async () => {
    const { ctx, ipc, event } = await mount()
    const handler = ipc.handlers.get(FETCH_CHANNEL)!
    const message = JSON.stringify({ type: 'client-request', rpcId: 'desktop-test', method: 'host.describe', payload: {} })
    const receipt = await handler(event, {
      url: 'http://dsh.internal/api/host.describe',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: base64(message),
    }) as DesktopFetchReceipt
    expect(receipt.status).toBe(200)
    expect(receipt.streamId).toBeTruthy()
    // The pump runs after the receipt resolves; wait for the end message.
    await vi.waitFor(() => { expect(event.streamMessages.at(-1)).toMatchObject({ kind: 'end' }) })
    const text = event.streamMessages
      .filter((m): m is Extract<DesktopStreamMessage, { kind: 'chunk' }> => m.kind === 'chunk')
      .map(m => Buffer.from(m.chunk, 'base64').toString('utf8'))
      .join('')
    expect(JSON.parse(text)).toMatchObject({
      type: 'server-response',
      rpcId: 'desktop-test',
      result: { ok: true, value: { version: 'test' } },
    })
    await ctx.fiber.dispose()
  })

  it('refuses an untrusted sender on every channel', async () => {
    const { ctx, ipc } = await mount({ trusted: false })
    const untrusted = new FakeEvent('https://evil.example/', true)
    await expect(ipc.handlers.get(FETCH_CHANNEL)!(untrusted, {})).rejects.toThrow(/untrusted sender/)
    expect(() => ipc.handlers.get(BOOT_GRAPH_CHANNEL)!(untrusted)).toThrow(/untrusted sender/)
    await expect(ipc.handlers.get(BUNDLE_CHANNEL)!(untrusted, { id: 'x' })).rejects.toThrow(/untrusted sender/)
    await ctx.fiber.dispose()
  })

  it('rejects malformed fetch payloads', async () => {
    const { ctx, ipc, event } = await mount()
    const handler = ipc.handlers.get(FETCH_CHANNEL)!
    await expect(handler(event, 'not-an-object')).rejects.toThrow(/must be an object/)
    await expect(handler(event, { url: 42 })).rejects.toThrow(/url must be a string/)
    await expect(handler(event, { url: 'x', method: 7 })).rejects.toThrow(/method must be a string/)
    await expect(handler(event, { url: 'x', headers: 'headers' })).rejects.toThrow(/headers must be an object/)
    await expect(handler(event, { url: 'x', headers: { bad: 1 } })).rejects.toThrow(/header values must be strings/)
    await expect(handler(event, { url: 'x', body: 1 })).rejects.toThrow(/body must be a base64 string/)
    await ctx.fiber.dispose()
  })

  it('accepts a bodyless fetch without headers (the apiproxy handler answers the carrier status)', async () => {
    const { ctx, ipc, event } = await mount()
    const handler = ipc.handlers.get(FETCH_CHANNEL)!
    const receipt = await handler(event, { url: 'http://dsh.internal/api/host.describe' }) as DesktopFetchReceipt
    // The default method is GET; a GET on a unary path is an unknown route.
    expect(receipt.status).toBe(404)
    await vi.waitFor(() => { expect(event.streamMessages.at(-1)).toMatchObject({ kind: 'end' }) })
    await ctx.fiber.dispose()
  })

  it('serves the rewritten boot graph', async () => {
    const { ctx, ipc, event } = await mount()
    const graph = ipc.handlers.get(BOOT_GRAPH_CHANNEL)!(event) as WebBootGraph
    expect(graph.entries[0]?.url).toBe('dsh-bundle:///@deepseek-ai/dsh-client-ui-theme?rev=abc')
    await ctx.fiber.dispose()
  })

  it('serves a registered bundle and refuses unknown ids', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-bundle-'))
    const bundlePath = join(dir, 'client.js')
    writeFileSync(bundlePath, 'register factory')
    const { ctx, ipc, event } = await mount({ bundlePath })
    const handler = ipc.handlers.get(BUNDLE_CHANNEL)!
    await expect(handler(event, { id: '@deepseek-ai/dsh-client-ui-theme' })).resolves.toBe('register factory')
    await expect(handler(event, { id: 'unknown-package' })).rejects.toThrow(/no client bundle is registered/)
    await expect(handler(event, 'not-an-object')).rejects.toThrow(/string id/)
    await ctx.fiber.dispose()
  })

  it('aborts a trusted stream on the abort channel and ignores untrusted aborts', async () => {
    const { ctx, ipc, event } = await mount()
    const fetchHandler = ipc.handlers.get(FETCH_CHANNEL)!
    const abortListener = ipc.listeners.get(ABORT_CHANNEL)!
    const message = JSON.stringify({ type: 'client-request', rpcId: 'abort-test', method: 'host.describe', payload: {} })
    const receipt = await fetchHandler(event, {
      url: 'http://dsh.internal/api/host.describe',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: base64(message),
    }) as DesktopFetchReceipt
    abortListener(event, { streamId: receipt.streamId })
    // An untrusted sender's abort is a silent no-op.
    abortListener(new FakeEvent('https://evil.example/', true), { streamId: receipt.streamId })
    // Malformed abort payloads are also silent no-ops.
    abortListener(event, 'not-an-object')
    abortListener(event, { streamId: 42 })
    abortListener(event, { streamId: 'unknown-stream' })
    await ctx.fiber.dispose()
  })

  it('disposes every registration and aborts open streams with the fiber', async () => {
    const { ctx, ipc } = await mount()
    await ctx.fiber.dispose()
    expect(ipc.removedHandlers.sort()).toEqual([BOOT_GRAPH_CHANNEL, BUNDLE_CHANNEL, FETCH_CHANNEL].sort())
    expect(ipc.removedListeners).toEqual([ABORT_CHANNEL])
    expect(ipc.handlers.size).toBe(0)
    expect(ipc.listeners.size).toBe(0)
  })
})
