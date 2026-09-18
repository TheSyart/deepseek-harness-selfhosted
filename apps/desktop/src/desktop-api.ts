/**
 * The desktop bridge contract shared by the preload and the renderer entry:
 * payload/message types re-exported from the owning bridge plugin (type-only,
 * no runtime code crosses), the `__DSH_DESKTOP__` world the preload exposes,
 * and the channel names (duplicated here because a sandboxed preload cannot
 * runtime-import the bridge's node bundle — keep them byte-identical with
 * the exports in `@deepseek-ai/dsh-desktop/startup`).
 * @module @deepseek-ai/dsh-desktop-app/desktop-api
 */

import type {
  DesktopFetchReceipt,
  DesktopStreamMessage,
} from '@deepseek-ai/dsh-desktop/startup'

export type { DesktopStreamMessage } from '@deepseek-ai/dsh-desktop/startup'

/** The renderer's fetch request payload (body base64-encoded; signals never cross IPC). */
export interface DesktopFetchPayload {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

/** What the preload exposes as `window.__DSH_DESKTOP__`. */
export interface DesktopBridgeApi {
  /** Read the rewritten client boot graph from the host composition. */
  bootGraph(): Promise<unknown>
  /** Read one plugin client bundle's source text. */
  bundleText(id: string): Promise<string>
  /** Start one fetch; resolves to the receipt, then {@link onStream} delivers the body. */
  fetchTransport(payload: DesktopFetchPayload): Promise<DesktopFetchReceipt>
  /** Abort one open fetch stream. */
  abort(streamId: string): void
  /** Subscribe to stream messages; the returned disposer removes the listener. */
  onStream(listener: (message: DesktopStreamMessage) => void): () => void
}

declare global {
  interface Window {
    __DSH_DESKTOP__: DesktopBridgeApi
  }
}

/** IPC channel names — byte-identical with `@deepseek-ai/dsh-desktop/startup`. */
export const FETCH_CHANNEL = 'dsh-desktop:fetch'
export const ABORT_CHANNEL = 'dsh-desktop:abort'
export const STREAM_CHANNEL = 'dsh-desktop:stream'
export const BOOT_GRAPH_CHANNEL = 'dsh-desktop:boot-graph'
export const BUNDLE_CHANNEL = 'dsh-desktop:bundle'
