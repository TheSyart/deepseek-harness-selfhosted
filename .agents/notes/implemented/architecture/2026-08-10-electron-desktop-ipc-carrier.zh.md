# Agent Note: The Electron desktop carrier — file:// plus IPC, the `webServer` facade, and the desktop bridge

Status: implemented

[English](2026-08-10-electron-desktop-ipc-carrier.md) | 中文

## 问题

Web 客户端架构把浏览器 GUI 拆成宿主供给的客户端插件树与不含 React 的对象层，其加载链、slot 与服务都不依赖载体。桌面壳唯一不同的是载体，而文档已经预留了形态：[web-server.md](../../../../docs/subsystems/web-server.zh.md) 写明 Electron 经 `file://` 加载已构建文件，并经 IPC 桥发送 fetch 请求而非使用 HTTP 服务器。当时并不存在桌面表面，因此要决定的是载体的构成——profile 组合、宿主侧桥、渲染端传输——而不触碰客户端契约。

## 决策

**桌面 profile 完整复用客户端花名册，只替换传输层。** `dsh --profile desktop` 依序叠加 `dsh-base`、`dsh-web-app` 与新 bundle `@deepseek-ai/dsh-desktop`；其补丁禁用 `webserver`、`web-startup`、`web-runtime` 与 `client-hmr`，把 `connection` 行的 `inject` 替换为 `[]`（被移除的 `web-runtime` 行曾是它的 `webRuntime` 提供者），并插入 `desktop-runtime` 与 `desktop-bridge`；bridge 行注入 `desktopStartup`、`clientModules`、`apiProxy` 与 `connection`，在纯 Node 下经 `disabled: !!js ctx.get('desktopStartup') === undefined` 自我禁用。Electron 窗口经 `file://` 加载已构建的渲染端 dist，所有线上需求——`/api` 形态的 fetch（单向 RPC 加 apiproxy SSE 编解码下行流）、插件客户端 bundle 与客户端 boot 图——都走五个 `ipcMain` 通道。bridge 把每次 fetch 交给 connection node 半的 `createSharedFetchHandler`，以 apiproxy 处理器为回落——与 Web 的 `/api` 路由相同的"拦截器优先"顺序，因此 `pluginInventory/list` 等 Typert Remote 端点在桌面上与 Web 完全一致地解析；回落对 `events.mux`/`events.host` GET 以 SSE 编解码应答（Web 路由此处回答 upgrade-required），因为 IPC 之上不存在 WebSocket。这次替换的渲染端半边是 [connection 进程内传输 seam](2026-08-10-connection-in-process-transport-seam.zh.md)。组合完全不监听 HTTP 端口。

**`desktop-runtime` 提供满足组合的 `webServer` facade，而不是改 `modules`/`connection` 的 inject。** 被挂载的 `modules` 与 `connection` node 半把路由注册与 index 转换绑定到 `webServer`，因此 `DesktopWebServerFacade` 以空操作席位接受 `register`/`registerUpgrade`（这些路径由 bridge 服务），让 `tapIndex`/`applyIndexTaps` 保持真实（应用渲染自己的 index 时应用它们），报告回环 `host`（目录选择器解析器读取它并选择原生选择器），并从 `port` 与 `registerFallback` 抛错，因为服务器并不存在。保持被挂载行的契约不动，正是同一次提供方替换在两种载体下都成立的原因。

**bridge 由启动器提供的 `desktopStartup` 服务门控。** 应用装配在任何配置行挂载之前提供它；它携带 Electron 的 `ipcMain` 表面与 `validateSender`——只接受 `senderFrame` URL 以应用 dist 目录 URL 开头的信任围栏。每个通道处理器都先校验发送者，所有通道注册与打开的流随插件 fiber 经同一个 effect 一并撤销。

**渲染端包装器只订阅一次（在任何 invoke 之前），并按流缓冲消息。** bridge 在主进程 fetch 一解析就开始泵送响应体，这可能早于 invoke 回执送达；在回执之后才注册的每次订阅都会丢掉这期间发出的每条消息，因此 `createIpcFetch` 持有一份流通道订阅，并在回执到达时接管其排队的消息。包装器还把 `file:///api/...` URL 路由到 bridge：connection 客户端从 `location.origin` 推导基址，而 Chromium 对 file 页面报告的原点是 `file://`，于是相对 `/api` 路径会相对 `file://` 解析，而不是进程内的 `dsh.internal` 权威。已安装的 transport 设置 `localAuthority: true`，依据是每个 IPC 通道都执行主进程发送者围栏；`file://` 本身不授予任何权限。渲染端因此使用 Host 持久化设置，而权限受限的远程浏览器仍只保留进程内设置。

**模型可见的定位文本是 `app:desktop-surface` prompt 片段**（order -98），由 `desktop-runtime` 注册；其文本指明交互表面是桌面应用，并说明传输是无 HTTP 端口的进程内 IPC 桥。快照覆盖与 Web 表面的 `app:web-surface` 同级：该片段同样没有专用 keyless 快照，而桌面片段的组装文本由包级测试逐字 pin（`packages/bundle/desktop/tests/desktop-runtime.spec.ts`）。

## 考虑过的替代方案

**复用 webserver 行——在回环端口上以 HTTP 服务 dist。** 否决：为 Electron 预留的设计字面就是 `file://` 加 IPC，而回环 HTTP 监听会让桌面表面与浏览器表面无法区分——同样的端口发现、同样无 TLS 的网络暴露面、同样的 URL 行——却换不来任何桌面收益。

**修改 `modules` 与 `connection` node 半，让它们在桌面侧放下 `webServer` 绑定。** 否决：这会为生产行分叉出两种组合形态，此后这两半的每一次改动都要做两份。facade 让两半保持字节相同、传输契约原样——载体替换对它们不可见。

**用 `protocol.handle` 注册 `app://` 自定义协议。** 否决：文档预留写的是 `file://` 加 IPC，自定义 scheme 会新增一条渲染端加载路径与新的 URL 语义——而且渲染端除了 preload 之外不保留任何 Electron 专属入口，自定义 scheme 却必须铸造并防卫这个入口。`file://` 加上改写成 `dsh-bundle:///<id>?rev=` 的图 URL，不需要模块系统尚未具备的任何东西。

**经 bridge 分块上传请求体。** 是推迟而非否决：fetch 请求体以一次结构化克隆拷贝（base64）穿过 IPC，大附件 POST 会在传输时复制一份到内存；分块路径可以后补，无需改变通道契约。

## 后果

桌面表面是同一套客户端花名册之上的一个补丁层加两个插件，渲染端运行同一个 Web shell 内核；UI 功能、slot 与对象层继承浏览器的全部行为，包括 `?fixture` 与重连语义。facade 的 `port` 抛错意味着真正需要服务器端口的行必须改挂真实 webserver 行——失败模式在首次读取时即响亮暴露。bridge 行的自我禁用使纯 Node 的 `dsh --profile desktop` 仍是合法的无窗口、无端口组合。已接受的代价：没有客户端插件 HMR 通道（`client-hmr` 行保持禁用；仅配置热重载仍生效），以及记录在 [bundle README](../../../../packages/bundle/desktop/README.zh.md) 的单次拷贝请求体上限。
