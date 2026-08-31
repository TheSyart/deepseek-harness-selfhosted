# @deepseek-ai/dsh-desktop-app

English | [中文](README.zh.md)

The Electron desktop application over the `desktop` profile: the main-process assembly that boots the profile, the preload that exposes the IPC bridge to the renderer, and the renderer entry that wires the transport. The host-side bridge and the runtime glue live in [`@deepseek-ai/dsh-desktop`](../../packages/bundle/desktop/README.md); this app owns the `electron` dependency, the window lifecycle, and the `desktopStartup` provider.

## Entry points

| Entry | Owns |
|---|---|
| [`src/main.ts`](src/main.ts) | profile boot (bundle layers, user patches, shipped presets, telemetry switch, config-only hot reload), the `desktopStartup` provider with the sender fence, the single-instance lock, and quit through fiber disposal |
| [`src/preload.ts`](src/preload.ts) | `window.__DSH_DESKTOP__` via `contextBridge`: boot graph, bundle text, fetch transport, abort, stream subscription |
| [`src/renderer/transport.ts`](src/renderer/transport.ts) | the IPC fetch (only `dsh.internal` URLs ride the bridge), the `dsh-bundle://` bundle loader, and `window.__DSH_BOOT__` installation |

The window loads the built renderer dist over `file://` with `contextIsolation: true` and `sandbox: false`; the composition listens on no HTTP port. Its sender-fenced IPC transport declares loopback-equivalent local authority, so the file page uses Host-backed user settings without granting the same access to an ordinary remote browser. A development run builds the renderer with `pnpm --filter @deepseek-ai/dsh-desktop-app run build`, then starts it with `pnpm --filter @deepseek-ai/dsh-desktop-app start`. An installed product payload must come from the root `pnpm run build:official` command so dynamic client bundles contain the official title, commit metadata, and DeepSeek Harness brand occupants.

## macOS icon

[`resources/deepseek-harness.svg`](resources/deepseek-harness.svg) contains the static black DeepSeek whale on a white 1024-pixel board. On macOS, `pnpm --filter @deepseek-ai/dsh-desktop-app run build:icon` uses `sharp` for the standard PNG representations and `iconutil` for the committed `deepseek-harness.icns`. Updating an installed local App follows the backup, payload-only staging, signing, and verification rules in [Installed desktop application updates](../../AGENTS.md#installed-desktop-application-updates); the icon is replaced only when separately authorized.

## Known Limitations and Deferred Work

- **No client-plugin HMR channel** — the bridge carries RPC, downlink streams, bundles, and the boot graph only; config-level `cordis.patch.yml` hot reload still applies through the app's boot watchers.
