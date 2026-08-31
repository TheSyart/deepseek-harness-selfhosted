# Agent Note: connection 原生传输 hooks——`window.__DSH_TRANSPORT__`

Status: implemented

[English](2026-08-10-connection-in-process-transport-seam.md) | 中文

## 问题

`connection` 的客户端 apply 原本只能在无服务器 fixture 与浏览器 HTTP/WebSocket 载体之间选择，而 [Web 客户端架构](2026-07-19-gui-web-client-architecture.zh.md)让对象层保持载体无关：无论由什么承载，Controller 泵送的始终是同样的两条下行流。原生壳需要在客户端插件树启动之前安装传输。Electron 还会从不透明的 `file://` 页面加载渲染端；其空 hostname 无法证明 Host 设置位于本机。

## 决策

**启动前传输入口是 `window.__DSH_TRANSPORT__`。** 导出的 `ClientTransportHooks` 提供 `createApiClient()`，用于 API Proxy 调用与两条下行流；提供 `fetch`，用于通用 Typert RPC；当载体拥有客户端 bundle 字节时，还可以提供 `loadBundle`。壳一次性提供全部传输操作，不会在启动后分别替换方法。

客户端 apply 的选择顺序是无服务器 fixture、已安装 hooks、默认浏览器载体。没有 hooks 时，served Web 应用继续使用 HTTP POST 发送 unary 调用，并使用两条只下行的 WebSocket。存在 hooks 时，壳提供的 `IApiClient` 满足同一 controller API，因此对象层、generation fence、重连行为与 `hostDescription` 生命周期都与载体无关。

**`localAuthority` 是原生载体的显式断言，不从 `file://` 推导。** hooks 提供该可选 flag 时，`ctx.connection.isLoopback` 采用其值；否则仍以页面 hostname 为准，hostname 为空的 file 页面不是 loopback。该 flag 允许经过发送者认证的同机壳让客户端设置使用 Host 持久化。它不会绕过 Host `/api` 信任栅栏，也不会认证远程浏览器；只有原生 bridge 已认证发送者的载体才能设置它。

**Electron 渲染端在 Web shell 内核启动前安装完整 hooks。** `createApiClient` 返回 apiproxy 的 `InProcessApiClient`，`fetch` 把 `dsh.internal` 与 `file:///api/...` 路由到 IPC bridge；`localAuthority: true` 依赖[桌面载体决策](2026-08-10-electron-desktop-ipc-carrier.zh.md)记载的主进程发送者围栏。渲染端还会替换页面 `fetch` 以支持通用 RPC，并把 IPC bundle loader 交给模块系统。

## 考虑过的替代方案

**在 IPC 之上猴子补丁一个 WebSocket shim。** 否决：apiproxy 进程内客户端已经公开所需的下行 iterator；shim 会重新实现对象层并不要求的传输形态。

**单独的桌面 connection 包，复制 handle 与 controller。** 否决：那会分叉重连状态机、generation fence 与 `hostDescription` 生命周期；transport hooks 保留一份 controller 实现。

**把所有 `file://` 页面都视为本机。** 否决：页面 scheme 不会认证渲染端，也不能证明 Host 位于同一机器。权限属于带发送者围栏的原生载体，而不是不透明 URL。

**把传输做成客户端树里的 Cordis 服务。** 否决：传输必须在客户端树及其 bundle loader 启动前就位，因此带类型的窗口全局变量是所需的启动前通道。

## 后果

没有安装 hooks 时，浏览器行为保持不变。原生壳可以替换物理载体而不 fork connection 插件；只有显式认证的壳才能让不透明页面使用 Host 持久化的客户端设置。渲染端壳拥有 hooks 安装、原生发送者认证与载体特有 URL 路由；原生 bridge 无法直接接收 `AbortSignal` 时，中止仍是协作式的。
