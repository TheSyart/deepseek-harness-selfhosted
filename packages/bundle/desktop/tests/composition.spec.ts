/**
 * REAL-composition test (packages/AGENTS.md): the desktop transport rows
 * boot through the real Loader over a test-only cordis.yml — the facade
 * satisfies the modules/connection node halves' webServer inject, the
 * bridge row gates itself on desktopStartup, and with the service present
 * the bridge registers its channels against the real composed tree.
 * The Loader's internal import table maps the composition rows to their
 * source-plane modules (the declared in-process launcher); external
 * surfaces only are stubbed: the api gateway (apiProxy) and the Electron
 * surface (desktopStartup).
 */

import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import type { IpcEventLike, IpcMainLike } from '../src/startup.ts'
import * as DesktopGlue from '../src/index.ts'
import * as DesktopBridge from '../src/startup.ts'
import ClientModuleRegistry from '@deepseek-ai/dsh-client-modules'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'

// The committed fixture template; the boot copies it into an ephemeral
// directory inside this package's tests tree so the include's write-back
// (a self-disposing row persists the tree) can never touch the committed
// file, and so the client-modules node half's createRequire(baseUrl) walks
// up to the repository's workspace node_modules.
const FIXTURE_TEMPLATE = new URL('./composition/cordis.yml', import.meta.url)
const FIXTURE_DIR = new URL('./composition/', import.meta.url)

/** A recording ipcMain stand-in for the Electron surface. */
class FakeIpcMain implements IpcMainLike {
  readonly handlers = new Map<string, (event: IpcEventLike, ...args: unknown[]) => unknown>()
  readonly listeners = new Map<string, (event: IpcEventLike, ...args: unknown[]) => void>()

  handle(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, listener)
  }

  on(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => void): void {
    this.listeners.set(channel, listener)
  }

  removeHandler(_channel: string): void {}
  removeListener(_channel: string, _listener: (event: IpcEventLike, ...args: unknown[]) => void): void {}
}

/** The host.describe stub the gateway contract needs if the bridge ever routes (it is not routed here). */
const stubApiProxy = { host: { describe: async () => ({ rpcId: 'x', result: { ok: true, value: {} } }) } } as unknown as ApiProxy

const disposers: Array<() => Promise<void>> = []
let dir: string | undefined

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

async function boot(options: { withDesktopStartup: boolean }): Promise<{ ctx: Context; ipc: FakeIpcMain | undefined }> {
  dir = mkdtempSync(join(FIXTURE_DIR.pathname, '.composition-'))
  copyFileSync(FIXTURE_TEMPLATE, join(dir, 'cordis.yml'))
  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-desktop', DesktopGlue],
    ['@deepseek-ai/dsh-desktop/startup', DesktopBridge],
    ['@deepseek-ai/dsh-client-modules', ClientModuleRegistry],
    ['@deepseek-ai/dsh-client-connection', Connection],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  ctx.provide('apiProxy', stubApiProxy as never)
  const ipc = options.withDesktopStartup ? new FakeIpcMain() : undefined
  if (ipc !== undefined) {
    ctx.provide('desktopStartup', {
      ipcMain: ipc,
      validateSender: event => event.senderFrame?.url.startsWith('file:///app/') === true,
    })
  }
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
  return { ctx, ipc }
}

describe('desktop real composition', () => {
  it('composes the facade, modules graph, and connection without a webserver, keeping the bridge disabled', async () => {
    const { ctx } = await boot({ withDesktopStartup: false })
    const server = ctx.get('webServer') as unknown as { host: string; port: number }
    expect(server.host).toBe('127.0.0.1')
    expect(() => server.port).toThrow(/no HTTP/)
    const graph = ctx.clientModules.graph()
    expect(graph.entries.map(entry => entry.id)).toEqual([
      '@deepseek-ai/dsh-client-modules',
      '@deepseek-ai/dsh-client-connection',
    ])
    const bridge = ctx.loader.entries().find(entry => entry.options.name === '@deepseek-ai/dsh-desktop/startup')
    expect(bridge).toBeDefined()
    expect(bridge!.fiber).toBeUndefined()
  })

  it('activates the bridge on the real tree when desktopStartup is present and serves the rewritten graph', async () => {
    const { ctx, ipc } = await boot({ withDesktopStartup: true })
    expect(ipc).toBeDefined()
    expect([...ipc!.handlers.keys()].sort()).toEqual(['dsh-desktop:boot-graph', 'dsh-desktop:bundle', 'dsh-desktop:fetch'].sort())
    const handler = ipc!.handlers.get('dsh-desktop:boot-graph')!
    const graph = handler({ senderFrame: { url: 'file:///app/dist/index.html' }, sender: { send: () => {} } }) as { entries: Array<{ url: string }> }
    expect(graph.entries.map(entry => entry.url)).toEqual([
      expect.stringMatching(/^dsh-bundle:\/\/\/@deepseek-ai\/dsh-client-modules\?rev=[0-9a-f]{12}$/),
      expect.stringMatching(/^dsh-bundle:\/\/\/@deepseek-ai\/dsh-client-connection\?rev=[0-9a-f]{12}$/),
    ])
    // The bundle endpoint resolves through the real registry.
    expect(ctx.clientModules.clientPath('@deepseek-ai/dsh-client-connection')).toBeTruthy()
    expect(ctx.fiber.state).toBe(FiberState.ACTIVE)
  })
})
