// @vitest-environment jsdom
/**
 * Renderer transport: the IPC fetch wrapper (routing, payload encoding,
 * stream assembly, abort), the bundle URL parser, and the bundle loader's
 * inline-script injection.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

/** Boot records the mocked shell kernel captures (el + seams per construction). */
const bootRecords: Array<{ el: Element; seams: unknown }> = []

vi.mock('@deepseek-ai/dsh-client-web', () => ({
  AppWebEntry: class {
    constructor(el: Element, seams?: unknown) {
      bootRecords.push({ el, seams })
    }
    async run(): Promise<void> {}
  },
}))

import type { DesktopBridgeApi, DesktopFetchPayload, DesktopStreamMessage } from '../src/desktop-api.ts'
import {
  base64Bytes,
  bootstrapDesktop,
  bundleIdFromUrl,
  createBundleLoader,
  createIpcFetch,
  isInternalTransportUrl,
  utf8Base64,
} from '../src/renderer/transport.ts'

/** A recording bridge: fetch resolves a receipt and the test pushes stream messages. */
class FakeBridge implements DesktopBridgeApi {
  readonly fetches: DesktopFetchPayload[] = []
  readonly aborted: string[] = []
  readonly bundleTexts: string[] = []
  readonly listeners: Array<(message: DesktopStreamMessage) => void> = []
  nextReceipt: { streamId: string; status: number; headers: Record<string, string> } = {
    streamId: 'stream-1',
    status: 200,
    headers: { 'content-type': 'application/json' },
  }
  private deferredReceipt: { resolve: (receipt: { streamId: string; status: number; headers: Record<string, string> }) => void } | undefined

  async bootGraph(): Promise<unknown> {
    return { rev: 'x', entries: [] }
  }

  async bundleText(id: string): Promise<string> {
    this.bundleTexts.push(id)
    // Valid JavaScript: jsdom executes inline classic-script text.
    return `globalThis.__desktopBundleLoaded = ${JSON.stringify(id)}`
  }

  async fetchTransport(payload: DesktopFetchPayload) {
    this.fetches.push(payload)
    if (this.deferredReceipt === undefined) return this.nextReceipt
    return new Promise<{ streamId: string; status: number; headers: Record<string, string> }>((resolve) => {
      this.deferredReceipt = { resolve }
    })
  }

  /** Make the next fetchTransport wait until {@link releaseReceipt}. */
  holdReceipt(): void {
    this.deferredReceipt = { resolve: () => {} }
  }

  /** Resolve the held receipt with the given identity. */
  releaseReceipt(receipt: { streamId: string; status: number; headers: Record<string, string> }): void {
    this.deferredReceipt?.resolve(receipt)
    this.deferredReceipt = undefined
  }

  abort(streamId: string): void {
    this.aborted.push(streamId)
  }

  onStream(listener: (message: DesktopStreamMessage) => void): () => void {
    this.listeners.push(listener)
    return () => {
      const index = this.listeners.indexOf(listener)
      if (index !== -1) this.listeners.splice(index, 1)
    }
  }

  push(message: DesktopStreamMessage): void {
    for (const listener of [...this.listeners]) listener(message)
  }
}

const originalFetch = globalThis.fetch
let bridge: FakeBridge

afterEach(() => {
  globalThis.fetch = originalFetch
  delete (globalThis as Record<string, unknown>).__DSH_DESKTOP__
  delete (globalThis as Record<string, unknown>).__DSH_BOOT__
  delete (globalThis as Record<string, unknown>).__ModuleLoader__
  delete (globalThis as Record<string, unknown>).__DSH_TRANSPORT_HANDLER__
  delete (globalThis as Record<string, unknown>).__DSH_TRANSPORT__
  bootRecords.length = 0
  vi.restoreAllMocks()
})

describe('url routing and encoding', () => {
  it('routes only the harness authorities to the bridge', () => {
    expect(isInternalTransportUrl('http://dsh.internal/api/session.list')).toBe(true)
    expect(isInternalTransportUrl('file:///api/session.list')).toBe(true)
    expect(isInternalTransportUrl('file:///api/events.mux')).toBe(true)
    expect(isInternalTransportUrl('https://example.com/api/x')).toBe(false)
    expect(isInternalTransportUrl('not-a-url')).toBe(false)
  })

  it('round-trips utf-8 through the base64 codecs', () => {
    const text = '中文 payload ✓'
    expect(new TextDecoder().decode(base64Bytes(utf8Base64(text)))).toBe(text)
  })
})

describe('createIpcFetch', () => {
  it('falls through to the original fetch for non-internal URLs', async () => {
    bridge = new FakeBridge()
    const fallback = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    const ipcFetch = createIpcFetch(bridge, fallback)
    const result = await ipcFetch('https://example.com/anything', { method: 'GET' })
    expect(fallback).toHaveBeenCalledWith('https://example.com/anything', expect.objectContaining({ method: 'GET' }))
    expect(result.status).toBe(200)
    expect(bridge.fetches).toHaveLength(0)
  })

  it('sends method, headers, and a base64 body to the bridge and assembles the streamed body', async () => {
    bridge = new FakeBridge()
    const ipcFetch = createIpcFetch(bridge, originalFetch)
    const reading = ipcFetch(new URL('http://dsh.internal/api/session.list'), {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: '{"hello":"世界"}',
    })
    const response = await reading
    expect(bridge.fetches).toEqual([{
      url: 'http://dsh.internal/api/session.list',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: utf8Base64('{"hello":"世界"}'),
    }])
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    const bodyText = response.text()
    bridge.push({ streamId: 'stream-1', kind: 'chunk', chunk: utf8Base64('{"ok":') })
    bridge.push({ streamId: 'other-stream', kind: 'chunk', chunk: utf8Base64('ignored') })
    bridge.push({ streamId: 'stream-1', kind: 'chunk', chunk: utf8Base64('true}') })
    bridge.push({ streamId: 'stream-1', kind: 'end' })
    await expect(bodyText).resolves.toBe('{"ok":true}')
  })

  it('routes a file://-resolved /api path to the bridge (Chromium file-page origins)', async () => {
    bridge = new FakeBridge()
    const ipcFetch = createIpcFetch(bridge, originalFetch)
    const response = await ipcFetch('file:///api/host.describe', { method: 'GET' })
    expect(bridge.fetches[0]?.url).toBe('file:///api/host.describe')
    bridge.push({ streamId: 'stream-1', kind: 'end' })
    await expect(response.text()).resolves.toBe('')
  })

  it('rejects the body stream on an error message and ignores foreign streams', async () => {
    bridge = new FakeBridge()
    const ipcFetch = createIpcFetch(bridge, originalFetch)
    const response = await ipcFetch('http://dsh.internal/api/x', { method: 'GET' })
    const bodyText = response.text()
    bridge.push({ streamId: 'stream-1', kind: 'error', message: 'handler blew up' })
    await expect(bodyText).rejects.toThrow('handler blew up')
  })

  it('buffers body messages that arrive before the receipt resolves', async () => {
    bridge = new FakeBridge()
    const ipcFetch = createIpcFetch(bridge, originalFetch)
    bridge.holdReceipt()
    const reading = ipcFetch('http://dsh.internal/api/session.list', { method: 'GET' })
    // The bridge pumps immediately on the main process: these messages land
    // before the invoke receipt reaches the renderer.
    bridge.push({ streamId: 'early-stream', kind: 'chunk', chunk: utf8Base64('{"early":') })
    bridge.push({ streamId: 'early-stream', kind: 'chunk', chunk: utf8Base64('true}') })
    bridge.push({ streamId: 'early-stream', kind: 'end' })
    bridge.releaseReceipt({ streamId: 'early-stream', status: 200, headers: { 'content-type': 'application/json' } })
    const response = await reading
    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('{"early":true}')
  })

  it('aborts the bridge stream when the caller signal aborts after the receipt', async () => {
    bridge = new FakeBridge()
    const ipcFetch = createIpcFetch(bridge, originalFetch)
    const controller = new AbortController()
    const response = await ipcFetch('http://dsh.internal/api/events.mux', { method: 'GET', signal: controller.signal })
    const bodyText = response.text()
    controller.abort()
    // The local rejection of the fetch is InProcessApiClient's job; the
    // wrapper's contract is the bridge abort notification.
    expect(bridge.aborted).toEqual(['stream-1'])
    bridge.push({ streamId: 'stream-1', kind: 'end' })
    await expect(bodyText).resolves.toBe('')
  })

  it('aborts the bridge stream when the response body is cancelled', async () => {
    bridge = new FakeBridge()
    const ipcFetch = createIpcFetch(bridge, originalFetch)
    const response = await ipcFetch('http://dsh.internal/api/events.mux', { method: 'GET' })
    await response.body?.cancel()
    expect(bridge.aborted).toEqual(['stream-1'])
  })

  it('rejects unsupported body types', async () => {
    bridge = new FakeBridge()
    const ipcFetch = createIpcFetch(bridge, originalFetch)
    const body = new ReadableStream<Uint8Array>()
    await expect(ipcFetch('http://dsh.internal/api/x', { method: 'POST', body })).rejects.toThrow(/unsupported fetch body/)
  })

  it('base64-encodes a Uint8Array request body', async () => {
    bridge = new FakeBridge()
    const ipcFetch = createIpcFetch(bridge, originalFetch)
    const reading = ipcFetch('http://dsh.internal/api/x', {
      method: 'POST',
      body: new Uint8Array([123, 34, 98, 34, 58, 49, 125]),
    })
    const response = await reading
    expect(bridge.fetches[0]?.body).toBe(btoa('{"b":1}'))
    bridge.push({ streamId: 'stream-1', kind: 'end' })
    await expect(response.text()).resolves.toBe('')
  })

  it('collects array-form request headers', async () => {
    bridge = new FakeBridge()
    const ipcFetch = createIpcFetch(bridge, originalFetch)
    const reading = ipcFetch('http://dsh.internal/api/x', {
      method: 'POST',
      headers: [['x-test', 'present']],
    })
    await reading
    expect(bridge.fetches[0]?.headers).toEqual({ 'x-test': 'present' })
    bridge.push({ streamId: 'stream-1', kind: 'end' })
  })

  it('collects plain-object request headers', async () => {
    bridge = new FakeBridge()
    const ipcFetch = createIpcFetch(bridge, originalFetch)
    const reading = ipcFetch('http://dsh.internal/api/x', {
      method: 'POST',
      headers: { 'x-object': 'kept' },
    })
    await reading
    expect(bridge.fetches[0]?.headers).toEqual({ 'x-object': 'kept' })
    bridge.push({ streamId: 'stream-1', kind: 'end' })
  })

  it('accepts a URL input and defaults the method to GET', async () => {
    bridge = new FakeBridge()
    const ipcFetch = createIpcFetch(bridge, originalFetch)
    const reading = ipcFetch(new URL('http://dsh.internal/api/x'))
    await reading
    expect(bridge.fetches[0]).toMatchObject({ url: 'http://dsh.internal/api/x', method: 'GET' })
    bridge.push({ streamId: 'stream-1', kind: 'end' })
  })

  it('accepts a Request input', async () => {
    bridge = new FakeBridge()
    const ipcFetch = createIpcFetch(bridge, originalFetch)
    const reading = ipcFetch(new Request('http://dsh.internal/api/x', { method: 'POST' }))
    await reading
    expect(bridge.fetches[0]).toMatchObject({ url: 'http://dsh.internal/api/x', method: 'POST' })
    bridge.push({ streamId: 'stream-1', kind: 'end' })
  })

  it('aborts a stream whose caller signal fired before the receipt resolved', async () => {
    bridge = new FakeBridge()
    const ipcFetch = createIpcFetch(bridge, originalFetch)
    const controller = new AbortController()
    bridge.holdReceipt()
    const reading = ipcFetch('http://dsh.internal/api/events.mux', { method: 'GET', signal: controller.signal })
    controller.abort()
    bridge.releaseReceipt({ streamId: 'late-stream', status: 200, headers: {} })
    await reading
    expect(bridge.aborted).toEqual(['late-stream'])
    bridge.push({ streamId: 'late-stream', kind: 'end' })
  })
})

describe('bundle loading', () => {
  it('parses bridge-minted URLs and rejects other shapes', () => {
    expect(bundleIdFromUrl('dsh-bundle:///@deepseek-ai/dsh-client-ui-theme?rev=abc')).toBe('@deepseek-ai/dsh-client-ui-theme')
    expect(bundleIdFromUrl('https://example/x.js')).toBeUndefined()
    expect(bundleIdFromUrl('dsh-bundle:///?rev=1')).toBeUndefined()
    expect(bundleIdFromUrl('junk')).toBeUndefined()
  })

  it('loads a bundle as an inline classic script', async () => {
    bridge = new FakeBridge()
    const loader = createBundleLoader(bridge)
    await loader('dsh-bundle:///@deepseek-ai/dsh-client-ui-theme?rev=abc')
    expect(bridge.bundleTexts).toEqual(['@deepseek-ai/dsh-client-ui-theme'])
    const script = document.head.querySelector('script')
    expect(script?.textContent).toBe('globalThis.__desktopBundleLoaded = "@deepseek-ai/dsh-client-ui-theme"')
    script?.remove()
  })

  it('fails on a URL the bridge never mints', async () => {
    bridge = new FakeBridge()
    const loader = createBundleLoader(bridge)
    await expect(loader('https://example/x.js')).rejects.toThrow(/unexpected bundle URL/)
  })
})

describe('bootstrapDesktop', () => {
  it('installs the boot graph, complete IPC transport, and page fetch, then runs the shell', async () => {
    bridge = new FakeBridge()
    ;(globalThis as Record<string, unknown>).__DSH_DESKTOP__ = bridge
    const el = document.createElement('div')
    await bootstrapDesktop(el)
    expect((globalThis as Record<string, unknown>).__DSH_BOOT__).toEqual({ rev: 'x', entries: [] })
    expect((globalThis as Record<string, unknown>).__ModuleLoader__).toMatchObject({ mode: 'queue' })
    const transport = (globalThis as Record<string, unknown>).__DSH_TRANSPORT__ as {
      createApiClient?: () => { events: { mux: unknown; host: unknown } }
      fetch?: unknown
      localAuthority?: boolean
    } | undefined
    expect(transport?.fetch).toBeTypeOf('function')
    expect(transport?.localAuthority).toBe(true)
    const api = transport?.createApiClient?.()
    expect(api?.events.mux).toBeTypeOf('function')
    expect(api?.events.host).toBeTypeOf('function')
    expect((globalThis as Record<string, unknown>).__DSH_TRANSPORT_HANDLER__).toBeUndefined()
    expect(globalThis.fetch).not.toBe(originalFetch)
    expect(bootRecords).toHaveLength(1)
    expect(bootRecords[0]?.el).toBe(el)
    const seams = bootRecords[0]?.seams as { loadBundle: unknown } | undefined
    expect(seams?.loadBundle).toBeTypeOf('function')
  })

  it('fails loud when the preload bridge is missing', async () => {
    const el = document.createElement('div')
    await expect(bootstrapDesktop(el)).rejects.toThrow(/preload bridge/)
  })
})
