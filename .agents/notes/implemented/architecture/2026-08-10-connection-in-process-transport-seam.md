# Agent Note: The connection native transport hooks — `window.__DSH_TRANSPORT__`

Status: implemented

English | [中文](2026-08-10-connection-in-process-transport-seam.zh.md)

## Problem

`connection`'s client apply could select only between the serverless fixture and the browser HTTP/WebSocket carrier, yet the [web client architecture](2026-07-19-gui-web-client-architecture.md) keeps the object layer carrier-agnostic: the Controller pumps the same two downlink streams whatever carries them. Native shells need to install a transport before the client plugin tree boots. Electron additionally loads the renderer from an opaque `file://` page, whose empty hostname cannot prove that Host settings are local.

## Decision

**The pre-boot transport entry is `window.__DSH_TRANSPORT__`.** The exported `ClientTransportHooks` provides `createApiClient()` for API Proxy calls and both downstream streams, `fetch` for generic Typert RPC, and optional `loadBundle` when the carrier owns client bundle bytes. A shell supplies all transport operations together instead of replacing individual methods after boot.

Client apply selects the serverless fixture first, installed hooks second, and the default browser carrier last. Without hooks, the served Web application retains HTTP POST for unary calls and two downlink WebSockets. With hooks, the shell-provided `IApiClient` satisfies the same controller API, so the object layer, generation fence, reconnect behavior, and `hostDescription` lifecycle remain carrier-independent.

**`localAuthority` is an explicit native-carrier assertion, not a property inferred from `file://`.** When hooks provide the optional flag, `ctx.connection.isLoopback` adopts it; otherwise the page hostname remains authoritative, and a file page with an empty hostname is non-loopback. The flag lets client settings choose Host persistence for a sender-authenticated same-machine shell. It does not bypass the Host `/api` trust fence or authenticate a remote browser, and only a carrier whose native bridge authenticates its sender may set it.

**The Electron renderer installs complete hooks before the Web shell kernel starts.** Its `createApiClient` returns the apiproxy `InProcessApiClient`, `fetch` routes `dsh.internal` and `file:///api/...` through the IPC bridge, and `localAuthority: true` relies on the main-process sender fence described by the [desktop carrier decision](2026-08-10-electron-desktop-ipc-carrier.md). The renderer also replaces page `fetch` for generic RPC and gives the module system its IPC bundle loader.

## Alternatives considered

**Monkeypatch a WebSocket shim over IPC.** Rejected: the apiproxy in-process client already exposes the required downlink iterators, and a shim would re-implement a transport form the object layer does not require.

**A separate desktop connection package duplicating the handle and controller.** Rejected: that forks the reconnect state machine, generation fence, and `hostDescription` lifecycle; transport hooks retain one controller implementation.

**Treat every `file://` page as local.** Rejected: page scheme does not authenticate the renderer or prove a same-machine Host. Authority belongs to the sender-fenced native carrier, not to an opaque URL.

**A Cordis service inside the client tree for the transport.** Rejected: the transport must exist before the client tree and its bundle loader start, so the typed window global is the required pre-boot channel.

## Consequences

Browser behavior remains unchanged when no hooks are installed. Native shells can replace the physical carrier without forking the connection plugin, and only explicitly authenticated shells can opt into Host-backed client settings from opaque pages. The renderer shell owns hook installation, native sender authentication, and carrier-specific URL routing; abort remains cooperative where a native bridge cannot receive an `AbortSignal` directly.
