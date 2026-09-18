# Desktop Surface

English | [中文](desktop.zh.md)

The Electron desktop carrier for the GUI host: the `desktop` profile over the same client roster the browser surface runs, minus every HTTP listener. [`@deepseek-ai/dsh-desktop`](../../packages/bundle/desktop/README.md) is the bundle — the patch layer over `dsh-web-app` plus the `desktop-runtime` plugin and the `desktop-bridge` IPC plugin — and [`apps/desktop`](../../apps/desktop/README.md) is the Electron assembly that owns the window, the preload, and the `desktopStartup` provider. The decisions live in the [desktop carrier note](../../.agents/notes/implemented/architecture/2026-08-10-electron-desktop-ipc-carrier.md) and the [connection seam note](../../.agents/notes/implemented/architecture/2026-08-10-connection-in-process-transport-seam.md).

The desktop surface is the counterpart of the [HTTP server](web-server.md), not a second capability seam: it reuses the mounted `modules` and `connection` node halves verbatim, so only the carrier differs — the transport swap the web client architecture reserves for Electron ("transport changes, contract stays", [`connection` README](../../packages/client/connection/README.md)). The renderer runs the same web shell kernel as the browser surface ([web client architecture note](../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md)).

## Profile composition

`dsh --profile desktop` stacks `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, then `@deepseek-ai/dsh-desktop` ([`PROFILE_TEMPLATES`](../../packages/boot/app-boot/src/profile.ts)). The bundle patch ([`cordis.patch.yml`](../../packages/bundle/desktop/cordis.patch.yml)) adapts the web layer:

- The `webserver`, `web-startup`, `web-runtime`, and `client-hmr` rows are disabled: the desktop surface serves no HTTP and has no client-HMR channel.
- The `connection` row's `inject` is replaced with `[]` and `trustedHosts` with the empty list, because the removed `web-runtime` row was its `webRuntime` provider.
- Two rows are inserted: `desktop-runtime` (package root) and `desktop-bridge` (`./bridge`). The bridge row injects `desktopStartup`, `clientModules`, `apiProxy`, and `connection`, and disables itself under plain Node through `disabled: !!js ctx.get('desktopStartup') === undefined`, so `dsh --profile desktop` boots a windowless, portless composition outside the app assembly.

## The `webServer` facade

`desktop-runtime` provides `ctx.webServer` as [`DesktopWebServerFacade`](../../packages/bundle/desktop/src/index.ts). The mounted `modules` and `connection` node halves bind their routes and index tap to `webServer`, and the facade keeps those rows composing unchanged while no server exists:

- `register` and `registerUpgrade` accept one route each as no-op seats — the bridge serves those paths instead — and return no-op disposers.
- `tapIndex` records an index transform; `applyIndexTaps` runs the recorded transforms in registration order. The desktop app calls it when it renders its own index, so the modules node half's boot-manifest injection keeps working.
- `host` reads the loopback bind `127.0.0.1`, the composition fact the directory-picker resolver reads to select the native chooser.
- `port` and `registerFallback` throw: no server exists, so there is no port and the SPA fallback seat has no meaning. A row that genuinely needs a server must compose the real webserver row.

## The IPC bridge

`desktop-bridge` ([source](../../packages/bundle/desktop/src/startup.ts)) serves the renderer over Electron `ipcMain`, so the composition listens on no port at all. Five channels:

| Channel | Direction | Carries |
|---|---|---|
| `dsh-desktop:fetch` | renderer → main | one `/api`-shaped fetch (unary RPC plus the apiproxy SSE-codec downlink streams); resolves to the receipt, then body chunks stream |
| `dsh-desktop:abort` | renderer → main | aborts one open fetch stream by its stream id |
| `dsh-desktop:stream` | main → renderer | one `chunk` / `end` / `error` body message per open stream |
| `dsh-desktop:boot-graph` | renderer → main | the rewritten client boot graph |
| `dsh-desktop:bundle` | renderer → main | one plugin client bundle's source text |

A fetch request body crosses as one base64 string — Electron IPC serializes the structured clone, so an `AbortSignal` never crosses — and the response body pumps as base64 `chunk` messages the renderer assembles into a `ReadableStream`. Each fetch routes through the connection node half's `createSharedFetchHandler` with the apiproxy handler as its fallback — the web `/api` route's interceptor-first order — so Typert Remote endpoints such as `pluginInventory/list` resolve identically on desktop and web; the fallback answers the `events.mux`/`events.host` GETs with the SSE codec where the web route answers upgrade-required, because no WebSocket exists over IPC. The renderer wrapper subscribes to the stream channel once, before any invoke, and buffers per-stream messages until each receipt claims its queue (the main process starts pumping before the invoke receipt can arrive); it also routes `file:///api/...` URLs to the bridge, because Chromium reports the origin `file://` for file pages, so the connection client's relative `/api` paths resolve against `file://` rather than the in-process `dsh.internal` authority. `rewriteGraph` rewrites every bundle URL in the composed client graph to `dsh-bundle:///<id>?rev=<rev>`; the renderer's bundle loader parses that scheme, reads the text over `dsh-desktop:bundle`, and runs it as an inline classic script, because a `file://` page cannot fetch plugin bundles over HTTP.

Every channel handler validates its sender first: the assembly's `validateSender` accepts only a `senderFrame` whose URL starts with the app dist directory URL, and a failed check refuses the request — the fire-and-forget abort listener cannot abort a stream an untrusted sender never opened, so it just ignores the message. Every `ipcMain` registration and every open stream unwind in one effect when the plugin fiber disposes.

## The desktop app assembly

[`apps/desktop`](../../apps/desktop/README.md) owns the Electron surface. The main process boots the `desktop` profile itself — bundle layers, user patch layers, shipped agent-preset root, telemetry switch, config-only hot reload — provides `desktopStartup` before any config row mounts, and creates one `BrowserWindow` (`contextIsolation: true`, `sandbox: false`) that loads the built renderer over `file://`. The preload exposes `window.__DSH_DESKTOP__` through `contextBridge`; the renderer entry reads the boot graph, installs the in-process transport handler, and runs the web shell kernel.

## The connection carrier seam

Before the client tree boots, the renderer installs `ClientTransportHooks` on `window.__DSH_TRANSPORT__`: `createApiClient` selects the in-process client, `fetch` routes only `dsh.internal` URLs to the bridge, `loadBundle` reads client bundles through IPC, and `localAuthority: true` records the sender-fenced native carrier. Downlink streams use the API Proxy SSE codec rather than WebSockets. `connection` derives `isLoopback: true` from that explicit authority, so a bare `file://` page receives no privilege while the installed desktop transport can use Host-backed settings. The seam contract is the [connection seam note](../../.agents/notes/implemented/architecture/2026-08-10-connection-in-process-transport-seam.md).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdesktopstartup--desktopstartupvalues"></a>

### `ctx.desktopStartup` — `DesktopStartupValues`

What the app assembly provides as `desktopStartup`: the Electron surface and the sender fence.

Source: [`packages/bundle/desktop/src/startup.ts`](../../packages/bundle/desktop/src/startup.ts)
<!-- END GENERATED cordis-surface -->
