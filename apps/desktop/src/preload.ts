/**
 * Desktop preload: exposes the IPC bridge as `window.__DSH_DESKTOP__` through
 * contextBridge. The renderer entry composes the fetch-shaped transport and
 * the bundle loader from these primitives.
 * @module @deepseek-ai/dsh-desktop-app/preload
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridgeApi, DesktopFetchPayload, DesktopStreamMessage } from './desktop-api.ts'
import {
  ABORT_CHANNEL,
  BOOT_GRAPH_CHANNEL,
  BUNDLE_CHANNEL,
  FETCH_CHANNEL,
  STREAM_CHANNEL,
} from './desktop-api.ts'

const api: DesktopBridgeApi = {
  bootGraph: () => ipcRenderer.invoke(BOOT_GRAPH_CHANNEL),
  bundleText: id => ipcRenderer.invoke(BUNDLE_CHANNEL, { id }),
  fetchTransport: (payload: DesktopFetchPayload) => ipcRenderer.invoke(FETCH_CHANNEL, payload),
  abort: (streamId: string) => {
    ipcRenderer.send(ABORT_CHANNEL, { streamId })
  },
  onStream: (listener) => {
    const wrapped = (_event: unknown, message: DesktopStreamMessage): void => {
      listener(message)
    }
    ipcRenderer.on(STREAM_CHANNEL, wrapped)
    return () => {
      ipcRenderer.removeListener(STREAM_CHANNEL, wrapped)
    }
  },
}

contextBridge.exposeInMainWorld('__DSH_DESKTOP__', api)
