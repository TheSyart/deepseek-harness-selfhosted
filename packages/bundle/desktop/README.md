# @deepseek-ai/dsh-desktop

English | [中文](README.zh.md)

The Electron desktop bundle for `dsh --profile desktop`: the patch layer that adapts the [`dsh-web-app`](../web-app/README.md) surface to a portless desktop carrier, plus the runtime glue and the IPC bridge. The profile stacks [`dsh-base`](../base/README.md), `dsh-web-app`, then this bundle.

The desktop surface reuses the web surface's entire client roster — every `dsh.client` UI row, the `modules` graph composer, `connection`, `api-gateway` — and replaces only the transport:

- The bundle patch disables `webserver`, `web-startup`, `web-runtime`, and `client-hmr`, and drops the `connection` row's `webRuntime` inject.
- `desktop-runtime` (package root) provides the **`webServer` composition facade**: the desktop profile serves no HTTP, but the mounted `modules` and `connection` node halves bind transport to `webServer`, so the facade accepts their route registrations as no-op seats. `host` reports the loopback bind (the directory-picker resolver reads it and selects the native chooser), and `port` fails loud because no server exists. It also registers the model-visible `app:desktop-surface` prompt section.
- `desktop-bridge` (`./bridge`) serves the renderer over Electron `ipcMain` channels — `/api`-shaped fetch (unary RPC plus the apiproxy SSE-codec downlink streams), plugin bundles, and the client boot graph — gated on the `desktopStartup` service the desktop app assembly provides; under plain Node the row disables itself.

The Electron window, preload, and renderer entry live in [`apps/desktop`](../../../apps/desktop/README.md), which owns the `electron` dependency and the `desktopStartup` provider.

## Model Experience

### `app:desktop-surface` prompt section

#### What the model sees

The section joins every session's system prompt once per request assembly, naming the desktop app as the interaction surface and stating that its transport is an in-process IPC bridge with no HTTP port.

#### Token effect

The section text is fixed and independent of the request; it contributes one constant block per system prompt, like the web surface's `app:web-surface` section.

#### KV Cache effect

The section text is a function of nothing request-varying, so it reuses the identical prefix tokens across requests of one session; no per-request KV-cache cost beyond the ordinary system prompt.

## Known Limitations and Deferred Work

- **Fetch request bodies cross Electron IPC as one structured-clone copy** — a large attachment POST duplicates its body in memory for the transfer; a chunked upload path would lower the resident bound.
- **No client-plugin HMR over the bridge** — the `client-hmr` row stays disabled; config-level `cordis.patch.yml` hot reload still applies through the app's boot watchers.
- **The facade's `port` read throws** — any row that genuinely needs a server port must compose the real webserver row instead; desktop rows never read it.
