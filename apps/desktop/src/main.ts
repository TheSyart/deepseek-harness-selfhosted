/**
 * Electron main-process assembly: boots the `desktop` profile (base +
 * web-app + desktop bundles) inside the Electron main, provides the
 * `desktopStartup` service the desktop bridge binds to, and owns the window
 * lifecycle. The composition serves no HTTP — the bridge registers its IPC
 * channels during boot, and the window then loads the built renderer dist
 * over file://.
 *
 * The profile glue is the launcher assembly the desktop surface owns
 * (mirroring apps/cli's profile-boot): bundle layers, the user patch layer,
 * shipped agent presets, the telemetry switch, and config-only hot reload.
 * @module @deepseek-ai/dsh-desktop-app/main
 */

/* v8 ignore file -- Electron-coupled assembly; the desktop smoke exercises this self-booting entry. */

import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app, BrowserWindow, ipcMain } from 'electron'
import { Context, FiberState } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import {
  boot,
  composeEntries,
  healProfilesModuleFallback,
  installFailLoud,
  loadLayeredEnv,
  loadOptionalPatches,
  loadProfile,
  PROFILE_PATCH_FILENAME,
  watchUserPatches,
  type Profile,
} from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import type { DesktopStartupValues } from '@deepseek-ai/dsh-desktop/startup'
import { ensureMainEntryArgument } from './main-runtime.ts'

const NAME = 'dsh'

/** Absolute path of this app's package.json (both anchors: src/ and lib/ sit one level under apps/desktop). */
const INSTALL_ANCHOR = fileURLToPath(new URL('../package.json', import.meta.url))

/** The shipped agent-preset root: beside the dsh CLI installation's own config, resolved through its package. */
const require = createRequire(import.meta.url)
const SHIPPED_PRESET_ROOT = join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'config/agent-presets')

/** The built renderer index the window loads. */
const DIST_INDEX = fileURLToPath(new URL('../dist/index.html', import.meta.url))
/** The renderer dist directory URL (the sender fence's accepted authority prefix). */
const DIST_DIR_URL = pathToFileURL(fileURLToPath(new URL('../dist/', import.meta.url))).href

ensureMainEntryArgument(process.argv, fileURLToPath(import.meta.url))

/** The telemetry switch targets the same row as the CLI launcher. */
const TELEMETRY_ROW_ID = 'session-telemetry-otel'

/** The empty root entry list every profile tree patches over. */
const PROFILE_ROOT_CONFIG = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`

/** Root config filename inside a profile directory. */
const PROFILE_ROOT_FILENAME = 'cordis.yml'

/** Home-level user patch layer, applied over the profile's own layer. */
function homePatchPath(): string {
  return join(resolveDshHome(), PROFILE_PATCH_FILENAME)
}

/**
 * Load and prepare the `desktop` profile: heal the shared module fallback,
 * then (re)write the empty root config (the vendored Loader's tree write-back
 * can bake composed rows into it, which would duplicate every bundle insert
 * on the next boot).
 * @returns the loaded profile.
 */
function prepareProfile(): Profile {
  healProfilesModuleFallback(INSTALL_ANCHOR)
  const profile = loadProfile(NAME, 'desktop', INSTALL_ANCHOR)
  writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)
  return profile
}

/** One profile's patch layers (application order) and the composed row index. */
interface ComposedProfile {
  profile: Profile
  /** Bundle layers concatenated — the part below the user layers on a live reload. */
  bundlePatches: PatchOptions[]
  /** Layers above the user layers on a live reload: the shipped-preset root and the telemetry switch. */
  overlays: PatchOptions[]
  /** id → row of the composed tree, for the launcher's own row checks. */
  rows: ReadonlyMap<string, EntryOptions>
}

/** The full patch stack of one composed profile, in application order. */
function allPatches(composed: ComposedProfile): PatchOptions[] {
  return [
    ...composed.bundlePatches,
    ...composed.profile.patches,
    ...loadOptionalPatches(NAME, homePatchPath()) ?? [],
    ...composed.overlays,
  ]
}

/**
 * Compose the desktop profile's effective patch stack: bundle layers in
 * `dsh.profile.bundles` order, the profile's user layer, the home-level user
 * layer, the shipped agent-preset root overlay, and the telemetry switch.
 * @returns the profile and its effective patch stack.
 */
function composeProfile(): ComposedProfile {
  const profile = prepareProfile()
  const homePatches = loadOptionalPatches(NAME, homePatchPath()) ?? []
  const bundlePatches = profile.layers.flatMap(layer => layer.patches)
  const rows = new Map<string, EntryOptions>()
  for (const row of composeEntries([bundlePatches, profile.patches, homePatches])) {
    if (typeof row.id === 'string') rows.set(row.id, row)
  }
  const overlays: PatchOptions[] = []
  if (rows.has('agent-presets')) {
    overlays.push({
      id: 'agent-presets',
      config: {
        ...(rows.get('agent-presets')?.config ?? {}) as Record<string, unknown>,
        roots: [{ path: SHIPPED_PRESET_ROOT, trust: 'system' }],
      },
    })
  }
  const telemetryDisabled = process.env.DSH_TELEMETRY_DISABLED
  if ((telemetryDisabled ?? '') !== '' && rows.has(TELEMETRY_ROW_ID)) {
    overlays.push({ id: TELEMETRY_ROW_ID, disabled: true })
  }
  return { profile, bundlePatches, overlays, rows }
}

/** The desktopStartup values the bridge binds to: the Electron surface and the sender fence. */
function desktopStartupValues(): DesktopStartupValues {
  return {
    ipcMain,
    validateSender: event => event.senderFrame !== null && event.senderFrame.url.startsWith(DIST_DIR_URL),
  }
}

/** The live root context, owned by the main process. */
const appContext: { current: Context | undefined } = { current: undefined }

let disposed = false

/** Dispose the composition tree once; every quit path funnels through here. */
async function disposeTree(): Promise<void> {
  if (disposed) return
  disposed = true
  await appContext.current?.fiber.dispose()
  appContext.current = undefined
}

/** Exit through tree disposal: quit requests defer until the tree quiesced. */
function requestExit(code: number): void {
  void disposeTree().then(() => { app.exit(code) })
}

/**
 * Boot the desktop profile and mount the config-only hot-reload watchers.
 * @returns the settled root context.
 */
async function runDesktopBoot(): Promise<Context> {
  const composed = composeProfile()
  const rootConfig = join(composed.profile.dir, PROFILE_ROOT_FILENAME)
  const composeLive = (): PatchOptions[] => structuredClone([
    ...composed.bundlePatches,
    ...loadOptionalPatches(NAME, composed.profile.patchPath) ?? [],
    ...loadOptionalPatches(NAME, homePatchPath()) ?? [],
    ...composed.overlays,
  ])
  const ctx = await boot(NAME, rootConfig, structuredClone(allPatches(composed)), (hostCtx) => {
    appContext.current = hostCtx
    // Before any config-tree entry mounts, so plugins resolve launch-time
    // environment values from the same immutable provenance snapshot.
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, loadLayeredEnv(NAME))
    hostCtx.provide('desktopStartup', desktopStartupValues())
  })
  appContext.current = ctx
  const signalShutdown = new AbortController()
  const interrupt = (code: number): void => {
    signalShutdown.abort()
    requestExit(code)
  }
  process.on('SIGTERM', () => { interrupt(0) })
  process.on('SIGINT', () => { interrupt(130) })
  installFailLoud(NAME, process, async () => {
    await disposeTree()
  })
  if (!signalShutdown.signal.aborted
    && ctx.fiber.state === FiberState.ACTIVE
    && ctx.get('loader') !== undefined) {
    if (ctx.get('hmr') === undefined) {
      if (ctx.get('timer') === undefined) {
        await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-timer' })
      }
      await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-hmr', config: { root: [] } })
    }
    await watchUserPatches(ctx, {
      binName: NAME,
      filename: composed.profile.patchPath,
      compose: composeLive,
    })
    await watchUserPatches(ctx, {
      binName: NAME,
      filename: homePatchPath(),
      compose: composeLive,
    })
  }
  return ctx
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let window: BrowserWindow | undefined
  app.on('second-instance', () => {
    if (window === undefined) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })
  app.on('window-all-closed', () => { requestExit(0) })
  app.on('before-quit', (event) => {
    if (disposed) return
    event.preventDefault()
    requestExit(0)
  })
  void app.whenReady().then(async () => {
    try {
      await runDesktopBoot()
    } catch (error) {
      console.error('desktop app: profile boot failed', error)
      app.exit(1)
      return
    }
    window = new BrowserWindow({
      width: 1280,
      height: 800,
      title: 'DeepSeek Harness',
      webPreferences: {
        preload: fileURLToPath(new URL('../lib/preload.js', import.meta.url)),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })
    window.on('closed', () => { window = undefined })
    if ((process.env.DSH_DESKTOP_DEVTOOLS ?? '') !== '') window.webContents.openDevTools()
    try {
      await window.loadFile(DIST_INDEX)
    } catch (error) {
      console.error('desktop app: renderer dist load failed; run pnpm --filter @deepseek-ai/dsh-desktop-app run build', error)
      await disposeTree()
      app.exit(1)
    }
  })
}
