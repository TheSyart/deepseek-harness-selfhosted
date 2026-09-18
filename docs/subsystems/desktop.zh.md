# 桌面表面

[English](desktop.md) | 中文

GUI 宿主的 Electron 桌面载体：与浏览器表面运行同一套客户端花名册的 `desktop` profile，只是没有任何 HTTP 监听。[`@deepseek-ai/dsh-desktop`](../../packages/bundle/desktop/README.zh.md) 是 bundle——覆盖 `dsh-web-app` 的补丁层，加上 `desktop-runtime` 插件与 `desktop-bridge` IPC 插件——[`apps/desktop`](../../apps/desktop/README.zh.md) 则是拥有窗口、preload 与 `desktopStartup` 提供者的 Electron 装配。决策记录在[桌面载体笔记](../../.agents/notes/implemented/architecture/2026-08-10-electron-desktop-ipc-carrier.zh.md)与 [connection seam 笔记](../../.agents/notes/implemented/architecture/2026-08-10-connection-in-process-transport-seam.zh.md)。

桌面表面是 [HTTP 服务器](web-server.zh.md)的对应物，而不是第二个能力 seam：它原样复用被挂载的 `modules` 与 `connection` node 半，因此只有载体不同——即 Web 客户端架构为 Electron 预留的传输替换（「传输改变，契约不变」，[`connection` README](../../packages/client/connection/README.zh.md)）。渲染端与浏览器表面运行同一个 Web shell 内核（[Web 客户端架构笔记](../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.zh.md)）。

## Profile 组合

`dsh --profile desktop` 依序叠加 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 与本 bundle（[`PROFILE_TEMPLATES`](../../packages/boot/app-boot/src/profile.ts)）。bundle 补丁（[`cordis.patch.yml`](../../packages/bundle/desktop/cordis.patch.yml)）适配 Web 层：

- `webserver`、`web-startup`、`web-runtime` 与 `client-hmr` 行被禁用：桌面表面不提供 HTTP，也没有客户端 HMR 通道。
- `connection` 行的 `inject` 被替换为 `[]`、`trustedHosts` 替换为空列表，因为被移除的 `web-runtime` 行曾是它的 `webRuntime` 提供者。
- 插入两行：`desktop-runtime`（包根）与 `desktop-bridge`（`./bridge`）。bridge 行注入 `desktopStartup`、`clientModules`、`apiProxy` 与 `connection`，并在纯 Node 下通过 `disabled: !!js ctx.get('desktopStartup') === undefined` 自我禁用，因此应用装配之外，`dsh --profile desktop` 会启动一个无窗口、无端口的组合。

## `webServer` facade

`desktop-runtime` 以 [`DesktopWebServerFacade`](../../packages/bundle/desktop/src/index.ts) 提供 `ctx.webServer`。被挂载的 `modules` 与 `connection` node 半把路由与 index 转换绑定到 `webServer`，facade 让这些行在不改动的情况下照常组合，而服务器并不存在：

- `register` 与 `registerUpgrade` 各以空操作席位接受一条路由——这些路径改由 bridge 提供服务——并返回空操作 disposer。
- `tapIndex` 记录一个 index 转换；`applyIndexTaps` 按注册顺序执行已记录的转换。桌面应用渲染自己的 index 时调用它，因此 modules node 半的 boot manifest 注入照常工作。
- `host` 读取回环绑定 `127.0.0.1`，这是目录选择器解析器借以选择原生选择器的组合事实。
- `port` 与 `registerFallback` 抛错：服务器并不存在，因此没有端口，SPA 回退席位也无意义。真正需要服务器的行必须改挂真实的 webserver 行。

## IPC 桥

`desktop-bridge`（[源码](../../packages/bundle/desktop/src/startup.ts)）通过 Electron `ipcMain` 为渲染端服务，因此组合完全不监听任何端口。五个通道：

| 通道 | 方向 | 承载 |
|---|---|---|
| `dsh-desktop:fetch` | 渲染端 → 主进程 | 一次 `/api` 形态的 fetch（单向 RPC 加 apiproxy SSE 编解码下行流）；先解析为回执，随后分块推送响应体 |
| `dsh-desktop:abort` | 渲染端 → 主进程 | 以 stream id 中止一个打开的 fetch 流 |
| `dsh-desktop:stream` | 主进程 → 渲染端 | 每个打开的流一条 `chunk` / `end` / `error` 响应体消息 |
| `dsh-desktop:boot-graph` | 渲染端 → 主进程 | 改写后的客户端 boot 图 |
| `dsh-desktop:bundle` | 渲染端 → 主进程 | 一个插件客户端 bundle 的源文本 |

fetch 请求体以单个 base64 字符串穿过——Electron IPC 序列化的是结构化克隆，因此 `AbortSignal` 永不穿过——响应体则以 base64 `chunk` 消息泵送，由渲染端重新组装成 `ReadableStream`。每次 fetch 都经 connection node 半的 `createSharedFetchHandler` 路由，以 apiproxy 处理器为回落——即 Web `/api` 路由的"拦截器优先"顺序——因此 `pluginInventory/list` 等 Typert Remote 端点在桌面与 Web 上一致地解析；回落对 `events.mux`/`events.host` GET 以 SSE 编解码应答（Web 路由此处回答 upgrade-required），因为 IPC 之上不存在 WebSocket。渲染端包装器在任何 invoke 之前只订阅一次流通道，并按流缓冲消息，直到每个回执接管自己的队列（主进程可能在 invoke 回执到达之前就开始泵送）；它还路由 `file:///api/...` URL 到 bridge，因为 Chromium 对 file 页面报告的原点是 `file://`，connection 客户端的相对 `/api` 路径会相对 `file://` 解析，而不是进程内的 `dsh.internal` 权威。`rewriteGraph` 把组合完成的客户端图中每个 bundle URL 改写为 `dsh-bundle:///<id>?rev=<rev>`；渲染端的 bundle loader 解析该 scheme，通过 `dsh-desktop:bundle` 读取文本，并以内联 classic script 执行，因为 `file://` 页面无法经 HTTP fetch 插件 bundle。

每个通道处理器都先校验发送者：装配提供的 `validateSender` 只接受 `senderFrame` URL 以应用 dist 目录 URL 开头的发送者，校验失败即拒绝该请求——fire-and-forget 的 abort 监听器无法中止不受信发送者从未打开过的流，因此它只忽略这条消息。所有 `ipcMain` 注册与所有打开的流在插件 fiber 卸载时经同一个 effect 一并撤销。

## 桌面应用装配

[`apps/desktop`](../../apps/desktop/README.zh.md) 拥有 Electron 表面。主进程自行启动 `desktop` profile——bundle 层、用户补丁层、随附 agent preset 根、遥测开关、仅配置热重载——在任何配置行挂载之前提供 `desktopStartup`，并创建一个经 `file://` 加载已构建渲染端的 `BrowserWindow`（`contextIsolation: true`、`sandbox: false`）。preload 经 `contextBridge` 暴露 `window.__DSH_DESKTOP__`；渲染端入口读取 boot 图、安装进程内传输处理器，并运行 Web shell 内核。

## connection 载体 seam

客户端树启动前，渲染端会在 `window.__DSH_TRANSPORT__` 上安装 `ClientTransportHooks`：`createApiClient` 选择进程内客户端，`fetch` 只把 `dsh.internal` URL 路由到 bridge，`loadBundle` 通过 IPC 读取客户端 bundle，`localAuthority: true` 则记录经过发送者围栏保护的原生载体。下行流走 API Proxy SSE 编解码，而不是 WebSocket。`connection` 从这项显式权限派生出 `isLoopback: true`，因此裸 `file://` 页面没有权限，而已安装的 Desktop transport 可以使用 Host 持久化设置。seam 契约见 [connection seam 笔记](../../.agents/notes/implemented/architecture/2026-08-10-connection-in-process-transport-seam.zh.md)。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdesktopstartup--desktopstartupvalues"></a>

### `ctx.desktopStartup` — `DesktopStartupValues`

What the app assembly provides as `desktopStartup`: the Electron surface and the sender fence.

Source: [`packages/bundle/desktop/src/startup.ts`](../../packages/bundle/desktop/src/startup.ts)
<!-- END GENERATED cordis-surface -->
