/**
 * Desktop preload: the exposed bridge surface forwards the five IPC
 * channels, and the stream subscription removes its wrapped listener.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const listeners = new Map<string, Array<(event: unknown, ...args: unknown[]) => void>>()
  const invoked: Array<{ channel: string; payload: unknown }> = []
  const sent: Array<{ channel: string; payload: unknown }> = []
  const api = {
    ipcRenderer: {
      invoke: (channel: string, payload?: unknown) => {
        invoked.push({ channel, payload })
        return Promise.resolve({ channel, payload })
      },
      send: (channel: string, payload: unknown) => { sent.push({ channel, payload }) },
      on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => {
        listeners.set(channel, [...(listeners.get(channel) ?? []), listener])
      },
      removeListener: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => {
        listeners.set(channel, (listeners.get(channel) ?? []).filter(entry => entry !== listener))
      },
    },
    contextBridge: {
      exposeInMainWorld: (key: string, value: unknown) => { (globalThis as Record<string, unknown>)[`__exposed_${key}`] = value },
    },
  }
  ;(globalThis as Record<string, unknown>).__electronTest = { listeners, invoked, sent }
  return api
})

import '../src/preload.ts'

const testState = (): {
  listeners: Map<string, Array<(event: unknown, ...args: unknown[]) => void>>
  invoked: Array<{ channel: string; payload: unknown }>
  sent: Array<{ channel: string; payload: unknown }>
} => (globalThis as Record<string, unknown>).__electronTest as never

describe('desktop preload', () => {
  it('exposes the bridge world and forwards invokes', async () => {
    const { invoked } = testState()
    const bridge = (globalThis as Record<string, unknown>).__exposed___DSH_DESKTOP__ as {
      bootGraph: () => Promise<unknown>
      bundleText: (id: string) => Promise<unknown>
      fetchTransport: (payload: unknown) => Promise<unknown>
    }
    await bridge.bootGraph()
    await bridge.bundleText('pkg')
    await bridge.fetchTransport({ url: 'x' })
    expect(invoked.map(entry => entry.channel)).toEqual(['dsh-desktop:boot-graph', 'dsh-desktop:bundle', 'dsh-desktop:fetch'])
    expect(invoked[1]?.payload).toEqual({ id: 'pkg' })
  })

  it('forwards aborts as sends and unsubscribes the wrapped stream listener', async () => {
    const { listeners, sent } = testState()
    const bridge = (globalThis as Record<string, unknown>).__exposed___DSH_DESKTOP__ as {
      abort: (streamId: string) => void
      onStream: (listener: (message: unknown) => void) => () => void
    }
    bridge.abort('stream-9')
    expect(sent).toEqual([{ channel: 'dsh-desktop:abort', payload: { streamId: 'stream-9' } }])
    const received: unknown[] = []
    const stop = bridge.onStream(message => received.push(message))
    const wrapped = listeners.get('dsh-desktop:stream')
    expect(wrapped).toHaveLength(1)
    wrapped![0]!({ senderFrame: null }, { streamId: 's', kind: 'end' })
    expect(received).toEqual([{ streamId: 's', kind: 'end' }])
    stop()
    expect(listeners.get('dsh-desktop:stream')).toHaveLength(0)
  })
})
